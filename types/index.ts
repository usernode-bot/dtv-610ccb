// Shared shapes for the API. Rows are camelCase here; SQL columns stay snake_case.

export interface Genre {
  id: number;
  slug: string;
  name: string;
}

export interface SeriesSummary {
  id: number;
  slug: string;
  title: string;
  genre: string;
  coverUrl: string | null;
  coverTone: number;
  isDemo: boolean;
  episodeCount: number;
  freeEpisodeCount: number;
  /** Always false for a guest. */
  following: boolean;
}

export type EpisodeState = 'free' | 'unlocked' | 'locked';

export interface EpisodeItem {
  id: number;
  seriesId: number;
  number: number;
  title: string;
  durationSeconds: number;
  coinPrice: number;
  state: EpisodeState;
  /** HLS stream. Only filled in for a free episode or one the viewer unlocked. */
  videoUrl: string | null;
}

/** An episode with the viewer's own progress (always empty for a guest). */
export interface EpisodeWithProgress extends EpisodeItem {
  /** Seconds watched, or null when the viewer has not started it. */
  positionSeconds: number | null;
  watched: boolean;
}

export interface SeriesDetail extends SeriesSummary {
  synopsis: string;
  viewCount: number;
  episodes: EpisodeWithProgress[];
  /**
   * Where "Continue" goes: the episode watched most recently when it is not
   * finished (resume true), else the one after it. Null with no history, or
   * when the last episode watched was the final one.
   */
  continueEpisode: { id: number; number: number; resume: boolean } | null;
}

export interface Profile {
  id: number;
  username: string;
  avatarUrl: string | null;
  coinBalance: number;
  createdAt: string;
}

export interface WatchHistoryItem {
  episodeId: number;
  seriesSlug: string;
  seriesTitle: string;
  episodeNumber: number;
  episodeTitle: string;
  positionSeconds: number;
  completed: boolean;
  updatedAt: string;
}

export type CoinTransactionType = 'purchase' | 'unlock' | 'reward' | 'ad';

export interface CoinTransaction {
  id: number;
  amount: number;
  type: CoinTransactionType;
  episodeId: number | null;
  note: string;
  createdAt: string;
}

/** Claims of a verified platform user token. */
export interface AuthUser {
  id: number | string;
  username: string;
  usernode_pubkey: string | null;
  locale: string | null;
  pur: string;
}
