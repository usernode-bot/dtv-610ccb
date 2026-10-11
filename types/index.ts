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
  /** Genre slugs picked during onboarding. */
  favoriteGenres: string[];
  /** When onboarding was finished, or null while it is still due. */
  onboardedAt: string | null;
  role: Role;
  createdAt: string;
}

export type Role = 'user' | 'admin';

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

export type CoinTransactionType = 'purchase' | 'unlock' | 'reward' | 'ad' | 'admin';

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

/** The admin dashboard's numbers. Coin figures are in coins. */
export interface AdminStats {
  totalUsers: number;
  /** People who watched, followed, unlocked or bought coins on the request's UTC day. */
  dailyActiveUsers: number;
  /** Coins bought (purchase ledger rows), all time and on the request's UTC day. */
  revenueCoins: number;
  revenueCoinsToday: number;
  /** Coins spent unlocking episodes, all time. */
  coinsSpent: number;
  topSeries: Array<{ slug: string; title: string; viewCount: number; coinsSpent: number }>;
}

/** A person as the admin user list shows them. */
export interface AdminUser {
  id: number;
  username: string;
  coinBalance: number;
  role: Role;
  banned: boolean;
  /** Listed in ADMIN_USERNAMES: admin on every sign-in, so not demotable or bannable here. */
  configuredAdmin: boolean;
  createdAt: string;
}
