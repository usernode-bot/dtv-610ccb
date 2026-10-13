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
  synopsis: string;
  genre: string;
  coverUrl: string | null;
  coverTone: number;
  isDemo: boolean;
  /** Genre slug, or null when the series has no linked genre. */
  genreSlug: string | null;
  /** The title in its original language ('' when it has none). */
  originalTitle: string;
  /** ISO 3166 country code (e.g. 'CN', 'KR'), or null. */
  country: string | null;
  /** Short dramas are vertical (9:16 posters); long dramas use 2:3. */
  format: SeriesFormat;
  /** 0 to 10, or null when not rated. */
  rating: number | null;
  isFeatured: boolean;
  /** YYYY-MM-DD, or null. */
  releasedOn: string | null;
  /** People who started an episode (see series.view_count). */
  viewCount: number;
  episodeCount: number;
  freeEpisodeCount: number;
  /** Always false for a guest. */
  following: boolean;
}

export type SeriesFormat = 'long' | 'short';

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
  /** Genre slugs picked during onboarding. */
  favoriteGenres: string[];
  /** When onboarding was finished, or null while it is still due. */
  onboardedAt: string | null;
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
