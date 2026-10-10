/** API rows are typed loosely on purpose: the SQL views are the schema of record. */
export type Row = Record<string, any>;

export interface Meta {
  seasons: { season: number; season_type: number; games: number; final_games: number; max_week: number | null }[];
  teams: { id: number; abbreviation: string; full_name: string; conference: string; division: string }[];
  latest: { season: number; season_type: number; week: number } | null;
}
