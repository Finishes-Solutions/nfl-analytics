/* =============================================================================
   003_semantic.sql — Semantic vector layer (Azure SQL native VECTOR, GA)
   One table for every embeddable document type + one search procedure.
   No external vector database: embeddings live beside the stats, so a single
   query can do semantic matching AND join to exact numbers.

   Requires: Azure SQL Database (native VECTOR is GA). Approximate indexes
   (VECTOR_SEARCH / CREATE VECTOR INDEX) are still preview — this layer uses
   exact VECTOR_DISTANCE with filters, which is the recommended pattern under
   ~50k candidate vectors. Season/doc_type filters keep us well under that.

   Document types (doc_type):
     play          key = plays.id            filtered corpus: scoring plays,
                                             3rd/4th downs (see embed.ts)
     player_card   key = player_id:season    composed narrative per player-season
     injury        key = snapshot_id         latest injury comments
     game_summary  key = game_id             composed game recap
============================================================================= */

IF OBJECT_ID('dbo.semantic_documents', 'U') IS NULL
CREATE TABLE dbo.semantic_documents (
  [doc_type]    NVARCHAR(24)   NOT NULL,
  [doc_key]     NVARCHAR(64)   NOT NULL,
  [player_id]   INT            NULL,
  [game_id]     INT            NULL,
  [team_id]     INT            NULL,
  [season]      INT            NULL,
  [content]     NVARCHAR(MAX)  NOT NULL,   -- the text that was embedded
  [embedding]   VECTOR(1536)   NOT NULL,   -- text-embedding-3-small
  [created_at]  DATETIME2(3)   NOT NULL CONSTRAINT DF_semdoc_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_semantic_documents] PRIMARY KEY CLUSTERED ([doc_type], [doc_key])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_semdoc_season' AND object_id=OBJECT_ID('dbo.semantic_documents'))
  CREATE NONCLUSTERED INDEX [IX_semdoc_season] ON dbo.semantic_documents ([doc_type],[season]);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_semdoc_player' AND object_id=OBJECT_ID('dbo.semantic_documents'))
  CREATE NONCLUSTERED INDEX [IX_semdoc_player] ON dbo.semantic_documents ([player_id]) WHERE [player_id] IS NOT NULL;
GO

/* ---------------------------------------------------------------------------
   sp_semantic_search — the one entry point the MCP tool calls.
   Caller embeds the user's question (same model!) and passes the vector as a
   JSON array string; optional filters narrow the candidate set BEFORE the
   distance computation, which is what keeps exact search fast.
--------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.sp_semantic_search
  @query_vector  NVARCHAR(MAX),          -- '[0.0123, -0.0456, ...]' (1536 dims)
  @doc_type      NVARCHAR(24)  = NULL,   -- NULL = all types
  @season_from   INT           = NULL,
  @season_to     INT           = NULL,
  @player_id     INT           = NULL,
  @top_n         INT           = 10
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @qv VECTOR(1536) = CAST(@query_vector AS VECTOR(1536));

  SELECT TOP (@top_n)
      d.doc_type,
      d.doc_key,
      d.player_id,
      d.game_id,
      d.team_id,
      d.season,
      d.content,
      VECTOR_DISTANCE('cosine', d.embedding, @qv) AS distance
  FROM dbo.semantic_documents d
  WHERE (@doc_type    IS NULL OR d.doc_type = @doc_type)
    AND (@season_from IS NULL OR d.season >= @season_from)
    AND (@season_to   IS NULL OR d.season <= @season_to)
    AND (@player_id   IS NULL OR d.player_id = @player_id)
  ORDER BY distance ASC;
END
GO

/* ---------------------------------------------------------------------------
   Example hybrid query — semantic match joined to exact stats in one round
   trip. This is the pattern the curated MCP tools should follow.

   -- "clutch performances like X" then pull the real box score:
   -- EXEC sp_semantic_search @qv, 'play', 2020, 2025, NULL, 20  → game_ids
   -- ... JOIN dbo.v_player_fantasy_game ON game_id ...
--------------------------------------------------------------------------- */
