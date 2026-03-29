/**
 * Minimal Supabase schema typing for compile-time safety.
 * Regenerate from CLI when schema stabilizes: `supabase gen types typescript`
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      hosts: {
        Row: {
          id: string;
          nextauth_user_id: string;
          google_sub: string | null;
          email: string | null;
          display_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          nextauth_user_id: string;
          google_sub?: string | null;
          email?: string | null;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["hosts"]["Insert"]>;
        Relationships: [];
      };
      google_oauth_tokens: {
        Row: {
          host_id: string;
          refresh_token: string;
          access_token: string | null;
          access_token_expires_at: string | null;
          scopes: string[];
          updated_at: string;
        };
        Insert: {
          host_id: string;
          refresh_token: string;
          access_token?: string | null;
          access_token_expires_at?: string | null;
          scopes: string[];
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["google_oauth_tokens"]["Insert"]>;
        Relationships: [];
      };
      uber_sessions: {
        Row: {
          host_id: string;
          cookie_ciphertext: string;
          x_csrf_token: string | null;
          authorization_header: string | null;
          validated_at: string;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          host_id: string;
          cookie_ciphertext: string;
          x_csrf_token?: string | null;
          authorization_header?: string | null;
          validated_at?: string;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["uber_sessions"]["Insert"]>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          host_id: string;
          restaurant_name_normalized: string;
          resolved: boolean;
          order_placed_at: string;
          [key: string]: unknown;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      restaurant_priors: {
        Row: {
          id: string;
          restaurant_name_normalized: string;
          late_rate_prior: number;
          mention_count: number;
          source: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          restaurant_name_normalized: string;
          late_rate_prior: number;
          mention_count?: number;
          source: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["restaurant_priors"]["Insert"]>;
        Relationships: [];
      };
      bets: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      bet_participants: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_bet_by_slug: { Args: { p_slug: string }; Returns: Json | null };
      get_restaurant_ranking_summaries: {
        Args: Record<string, never>;
        Returns: {
          restaurant_name_normalized: string;
          display_name: string;
          resolved_order_count: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
