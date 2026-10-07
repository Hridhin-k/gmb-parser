export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      grm_audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          metadata: Json
          user_agent: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          user_agent?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          user_agent?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_clients: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_clients_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_google_accounts: {
        Row: {
          account_display_name: string
          account_type: string
          connection_id: string
          created_at: string
          google_account_name: string
          id: string
          updated_at: string
          verification_state: string | null
          workspace_id: string
        }
        Insert: {
          account_display_name: string
          account_type: string
          connection_id: string
          created_at?: string
          google_account_name: string
          id?: string
          updated_at?: string
          verification_state?: string | null
          workspace_id: string
        }
        Update: {
          account_display_name?: string
          account_type?: string
          connection_id?: string
          created_at?: string
          google_account_name?: string
          id?: string
          updated_at?: string
          verification_state?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_google_accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "grm_google_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grm_google_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_google_connections: {
        Row: {
          access_token_enc: string
          authorized_by_user_id: string
          created_at: string
          google_email: string
          id: string
          last_refreshed_at: string | null
          refresh_token_enc: string
          scopes: string[]
          status: Database["public"]["Enums"]["grm_connection_status"]
          token_expires_at: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          access_token_enc: string
          authorized_by_user_id: string
          created_at?: string
          google_email: string
          id?: string
          last_refreshed_at?: string | null
          refresh_token_enc: string
          scopes?: string[]
          status?: Database["public"]["Enums"]["grm_connection_status"]
          token_expires_at: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          access_token_enc?: string
          authorized_by_user_id?: string
          created_at?: string
          google_email?: string
          id?: string
          last_refreshed_at?: string | null
          refresh_token_enc?: string
          scopes?: string[]
          status?: Database["public"]["Enums"]["grm_connection_status"]
          token_expires_at?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_google_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_google_locations: {
        Row: {
          address_formatted: string | null
          average_rating: number | null
          client_id: string | null
          created_at: string
          google_account_id: string
          google_location_name: string
          id: string
          is_active: boolean
          last_synced_at: string | null
          location_title: string
          place_id: string | null
          primary_phone: string | null
          store_code: string | null
          sync_completed_at: string | null
          sync_cursor: string | null
          sync_error: string | null
          sync_started_at: string | null
          sync_status: Database["public"]["Enums"]["grm_sync_status"]
          total_review_count: number | null
          updated_at: string
          website_uri: string | null
          workspace_id: string
        }
        Insert: {
          address_formatted?: string | null
          average_rating?: number | null
          client_id?: string | null
          created_at?: string
          google_account_id: string
          google_location_name: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          location_title: string
          place_id?: string | null
          primary_phone?: string | null
          store_code?: string | null
          sync_completed_at?: string | null
          sync_cursor?: string | null
          sync_error?: string | null
          sync_started_at?: string | null
          sync_status?: Database["public"]["Enums"]["grm_sync_status"]
          total_review_count?: number | null
          updated_at?: string
          website_uri?: string | null
          workspace_id: string
        }
        Update: {
          address_formatted?: string | null
          average_rating?: number | null
          client_id?: string | null
          created_at?: string
          google_account_id?: string
          google_location_name?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          location_title?: string
          place_id?: string | null
          primary_phone?: string | null
          store_code?: string | null
          sync_completed_at?: string | null
          sync_cursor?: string | null
          sync_error?: string | null
          sync_started_at?: string | null
          sync_status?: Database["public"]["Enums"]["grm_sync_status"]
          total_review_count?: number | null
          updated_at?: string
          website_uri?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_google_locations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "grm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grm_google_locations_google_account_id_fkey"
            columns: ["google_account_id"]
            isOneToOne: false
            referencedRelation: "grm_google_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grm_google_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_location_insights: {
        Row: {
          ai_model: string
          analysis: Json
          avg_rating: number | null
          created_at: string
          generated_at: string
          generated_by: string | null
          highlights: Json
          id: string
          location_id: string
          prompt_version: string
          review_count: number
          risks: Json
          sentiment_label: string
          source_hash: string
          summary: string
          themes: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_model: string
          analysis?: Json
          avg_rating?: number | null
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          highlights?: Json
          id?: string
          location_id: string
          prompt_version: string
          review_count?: number
          risks?: Json
          sentiment_label: string
          source_hash: string
          summary: string
          themes?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_model?: string
          analysis?: Json
          avg_rating?: number | null
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          highlights?: Json
          id?: string
          location_id?: string
          prompt_version?: string
          review_count?: number
          risks?: Json
          sentiment_label?: string
          source_hash?: string
          summary?: string
          themes?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_location_insights_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "grm_google_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grm_location_insights_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_review_ai_drafts: {
        Row: {
          ai_model: string
          ai_prompt_hash: string
          content: string
          created_at: string
          edited_at: string | null
          edited_by: string | null
          edited_content: string | null
          generated_by: string
          generation_params: Json
          id: string
          prompt_version: string
          review_id: string
          status: Database["public"]["Enums"]["grm_ai_draft_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_model: string
          ai_prompt_hash: string
          content: string
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          edited_content?: string | null
          generated_by: string
          generation_params?: Json
          id?: string
          prompt_version: string
          review_id: string
          status?: Database["public"]["Enums"]["grm_ai_draft_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_model?: string
          ai_prompt_hash?: string
          content?: string
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          edited_content?: string | null
          generated_by?: string
          generation_params?: Json
          id?: string
          prompt_version?: string
          review_id?: string
          status?: Database["public"]["Enums"]["grm_ai_draft_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_review_ai_drafts_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "grm_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grm_review_ai_drafts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_review_replies: {
        Row: {
          ai_draft_id: string | null
          approved_at: string | null
          approved_by: string | null
          content: string
          created_at: string
          created_by: string
          failure_count: number
          id: string
          last_error: string | null
          published_at: string | null
          published_by: string | null
          review_id: string
          source: Database["public"]["Enums"]["grm_reply_source"]
          status: Database["public"]["Enums"]["grm_reply_pub_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_draft_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          content: string
          created_at?: string
          created_by: string
          failure_count?: number
          id?: string
          last_error?: string | null
          published_at?: string | null
          published_by?: string | null
          review_id: string
          source: Database["public"]["Enums"]["grm_reply_source"]
          status?: Database["public"]["Enums"]["grm_reply_pub_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_draft_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          content?: string
          created_at?: string
          created_by?: string
          failure_count?: number
          id?: string
          last_error?: string | null
          published_at?: string | null
          published_by?: string | null
          review_id?: string
          source?: Database["public"]["Enums"]["grm_reply_source"]
          status?: Database["public"]["Enums"]["grm_reply_pub_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_review_replies_ai_draft_id_fkey"
            columns: ["ai_draft_id"]
            isOneToOne: false
            referencedRelation: "grm_review_ai_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grm_review_replies_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "grm_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grm_review_replies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_reviews: {
        Row: {
          comment: string | null
          created_at: string
          first_synced_at: string
          google_reply_comment: string | null
          google_reply_update_time: string | null
          google_review_id: string
          google_review_name: string
          id: string
          last_synced_at: string
          location_id: string
          reply_status: Database["public"]["Enums"]["grm_reply_status"]
          review_create_time: string
          review_update_time: string | null
          review_url: string | null
          reviewer_display_name: string
          reviewer_is_anonymous: boolean
          reviewer_profile_url: string | null
          star_rating: number
          sync_hash: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          first_synced_at?: string
          google_reply_comment?: string | null
          google_reply_update_time?: string | null
          google_review_id: string
          google_review_name: string
          id?: string
          last_synced_at?: string
          location_id: string
          reply_status?: Database["public"]["Enums"]["grm_reply_status"]
          review_create_time: string
          review_update_time?: string | null
          review_url?: string | null
          reviewer_display_name?: string
          reviewer_is_anonymous?: boolean
          reviewer_profile_url?: string | null
          star_rating: number
          sync_hash?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          first_synced_at?: string
          google_reply_comment?: string | null
          google_reply_update_time?: string | null
          google_review_id?: string
          google_review_name?: string
          id?: string
          last_synced_at?: string
          location_id?: string
          reply_status?: Database["public"]["Enums"]["grm_reply_status"]
          review_create_time?: string
          review_update_time?: string | null
          review_url?: string | null
          reviewer_display_name?: string
          reviewer_is_anonymous?: boolean
          reviewer_profile_url?: string | null
          star_rating?: number
          sync_hash?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_reviews_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "grm_google_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grm_reviews_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_user_consents: {
        Row: {
          ai_accepted_at: string
          created_at: string
          terms_accepted_at: string
          user_id: string
        }
        Insert: {
          ai_accepted_at: string
          created_at?: string
          terms_accepted_at: string
          user_id: string
        }
        Update: {
          ai_accepted_at?: string
          created_at?: string
          terms_accepted_at?: string
          user_id?: string
        }
        Relationships: []
      }
      grm_workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["grm_member_role"]
          status: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["grm_member_role"]
          status?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["grm_member_role"]
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_workspace_members: {
        Row: {
          active: boolean
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string
          role: Database["public"]["Enums"]["grm_member_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["grm_member_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["grm_member_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      grm_my_workspace_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      grm_location_review_stats: {
        Args: { p_workspace_id: string }
        Returns: {
          location_id: string
          review_count: number
          unanswered: number
          drafts: number
          approved: number
          failed: number
          published: number
          critical: number
          rating_sum: number
          r1: number
          r2: number
          r3: number
          r4: number
          r5: number
          last_7d: number
          last_30d: number
          last_review_at: string | null
        }[]
      }
      grm_review_trends: {
        Args: { p_workspace_id: string; p_months?: number; p_client_id?: string | null }
        Returns: {
          month: string
          review_count: number
          avg_rating: number | null
          negative: number
          positive: number
          replied: number
          avg_response_hours: number | null
        }[]
      }
    }
    Enums: {
      grm_ai_draft_status: "generated" | "edited" | "discarded"
      grm_connection_status: "active" | "expired" | "revoked"
      grm_member_role: "owner" | "admin" | "member"
      grm_sync_status: "idle" | "syncing" | "success" | "partial" | "failed"
      grm_reply_pub_status:
        | "draft"
        | "approved"
        | "pending_publish"
        | "published"
        | "failed"
      grm_reply_source: "ai" | "manual"
      grm_reply_status:
        | "none"
        | "draft"
        | "approved"
        | "pending_publish"
        | "published"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience helpers
export type GrmTables = Database["public"]["Tables"]

export type GrmUserConsent     = GrmTables["grm_user_consents"]["Row"]
export type GrmWorkspace        = GrmTables["grm_workspaces"]["Row"]
export type GrmWorkspaceInvite  = GrmTables["grm_workspace_invites"]["Row"]
export type GrmWorkspaceMember  = GrmTables["grm_workspace_members"]["Row"]
export type GrmClient           = GrmTables["grm_clients"]["Row"]
export type GrmGoogleConnection = GrmTables["grm_google_connections"]["Row"]
export type GrmGoogleAccount    = GrmTables["grm_google_accounts"]["Row"]
export type GrmGoogleLocation   = GrmTables["grm_google_locations"]["Row"]
// client_id is nullable: null = discovered but not yet mapped to a client
export type GrmReview           = GrmTables["grm_reviews"]["Row"]
export type GrmReviewAiDraft    = GrmTables["grm_review_ai_drafts"]["Row"]
export type GrmReviewReply      = GrmTables["grm_review_replies"]["Row"]
export type GrmAuditLog         = GrmTables["grm_audit_logs"]["Row"]
export type GrmLocationInsight  = GrmTables["grm_location_insights"]["Row"]

export type GrmEnums = Database["public"]["Enums"]
export type GrmMemberRole       = GrmEnums["grm_member_role"]
export type GrmConnectionStatus = GrmEnums["grm_connection_status"]
export type GrmReplyStatus      = GrmEnums["grm_reply_status"]
export type GrmReplyPubStatus   = GrmEnums["grm_reply_pub_status"]
export type GrmReplySource      = GrmEnums["grm_reply_source"]
export type GrmAiDraftStatus    = GrmEnums["grm_ai_draft_status"]
export type GrmSyncStatus       = GrmEnums["grm_sync_status"]

// Safe connection type — excludes token columns for client-facing use
export type GrmGoogleConnectionSafe = Omit<
  GrmGoogleConnection,
  "access_token_enc" | "refresh_token_enc"
>
