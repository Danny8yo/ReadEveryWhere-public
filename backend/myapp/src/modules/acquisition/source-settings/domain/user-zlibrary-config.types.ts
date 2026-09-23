export interface UserZlibraryConfigRow {
  id: number;
  user_id: number;
  base_url: string;
  remix_userid: string;
  remix_userkey: string;
  downloads_today: number;
  downloads_limit: number;
  is_premium: number;
  is_active: number;
  last_login_at: string | null;
  login_status: string;
  login_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserZlibraryConfig {
  id: number;
  userId: number;
  baseUrl: string;
  remixUserid: string;
  remixUserkey: string;
  downloadsToday: number;
  downloadsLimit: number;
  isPremium: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  loginStatus: "pending" | "success" | "failed";
  loginError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ZlibraryLoginResult {
  remix_userid: string;
  remix_userkey: string;
  downloads_today: number;
  downloads_limit: number;
  is_premium: boolean;
}
