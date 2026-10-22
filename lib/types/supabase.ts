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
      grm_agency_branding: {
        Row: {
          workspace_id: string
          logo_url: string | null
          hide_product_name: boolean
          custom_domain: string | null
          domain_token: string | null
          domain_verified_at: string | null
          sender_email: string | null
          updated_at: string
        }
        Insert: {
          workspace_id: string
          logo_url?: string | null
          hide_product_name?: boolean
          custom_domain?: string | null
          domain_token?: string | null
          domain_verified_at?: string | null
          sender_email?: string | null
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          logo_url?: string | null
          hide_product_name?: boolean
          custom_domain?: string | null
          domain_token?: string | null
          domain_verified_at?: string | null
          sender_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      grm_client_onboarding: {
        Row: {
          id: string
          workspace_id: string
          client_id: string
          token_hash: string
          expires_at: string
          used_at: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          client_id: string
          token_hash: string
          expires_at: string
          used_at?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          client_id?: string
          token_hash?: string
          expires_at?: string
          used_at?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      grm_usage_events: {
        Row: {
          id: string
          workspace_id: string
          client_id: string | null
          kind: string
          source_id: string
          occurred_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          client_id?: string | null
          kind: string
          source_id: string
          occurred_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          client_id?: string | null
          kind?: string
          source_id?: string
          occurred_at?: string
        }
        Relationships: []
      }
      grm_clients: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          contact_email: string | null
          website: string | null
          account_manager_user_id: string | null
          brand_name: string | null
          logo_url: string | null
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
          contact_email?: string | null
          website?: string | null
          account_manager_user_id?: string | null
          brand_name?: string | null
          logo_url?: string | null
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
          contact_email?: string | null
          website?: string | null
          account_manager_user_id?: string | null
          brand_name?: string | null
          logo_url?: string | null
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
      grm_ai_generation_jobs: {
        Row: {
          attempts: number
          content: string | null
          created_at: string
          draft_id: string | null
          id: string
          kind: string
          last_error: string | null
          location_id: string | null
          model: string
          payload: Json
          reply_id: string | null
          review_id: string | null
          route: string | null
          scope_id: string | null
          scope_kind: string | null
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          attempts?: number
          content?: string | null
          created_at?: string
          draft_id?: string | null
          id?: string
          kind: string
          last_error?: string | null
          location_id?: string | null
          model: string
          payload?: Json
          reply_id?: string | null
          review_id?: string | null
          route?: string | null
          scope_id?: string | null
          scope_kind?: string | null
          status?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          attempts?: number
          content?: string | null
          created_at?: string
          draft_id?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          location_id?: string | null
          model?: string
          payload?: Json
          reply_id?: string | null
          review_id?: string | null
          route?: string | null
          scope_id?: string | null
          scope_kind?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_ai_generation_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grm_ai_generation_jobs_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "grm_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grm_ai_generation_jobs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "grm_google_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_bulk_jobs: {
        Row: {
          action: string
          created_at: string
          failed: number
          id: string
          last_error: string | null
          results: Json
          review_ids: Json
          status: string
          succeeded: number
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          action: string
          created_at?: string
          failed?: number
          id?: string
          last_error?: string | null
          results?: Json
          review_ids?: Json
          status?: string
          succeeded?: number
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          action?: string
          created_at?: string
          failed?: number
          id?: string
          last_error?: string | null
          results?: Json
          review_ids?: Json
          status?: string
          succeeded?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_bulk_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_ai_usage_monthly: {
        Row: {
          calls: number
          estimated_usd: number
          input_tokens: number
          month: string
          operation: string
          output_tokens: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          calls?: number
          estimated_usd?: number
          input_tokens?: number
          month: string
          operation: string
          output_tokens?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          calls?: number
          estimated_usd?: number
          input_tokens?: number
          month?: string
          operation?: string
          output_tokens?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_ai_usage_monthly_workspace_id_fkey"
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
          client_id: string | null
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
          client_id?: string | null
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
          client_id?: string | null
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
          reviews_full_synced_at: string | null
          location_title: string
          place_id: string | null
          group_id: string | null
          brand_id: string | null
          manager_user_id: string | null
          voice_of_merchant: boolean | null
          google_duplicate_of: string | null
          hold_reason: string | null
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
          reviews_full_synced_at?: string | null
          location_title: string
          place_id?: string | null
          group_id?: string | null
          brand_id?: string | null
          manager_user_id?: string | null
          voice_of_merchant?: boolean | null
          google_duplicate_of?: string | null
          hold_reason?: string | null
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
          reviews_full_synced_at?: string | null
          location_title?: string
          place_id?: string | null
          group_id?: string | null
          brand_id?: string | null
          manager_user_id?: string | null
          voice_of_merchant?: boolean | null
          google_duplicate_of?: string | null
          hold_reason?: string | null
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
      grm_location_tags: {
        Row: { id: string; workspace_id: string; name: string; created_at: string }
        Insert: { id?: string; workspace_id: string; name: string }
        Update: { name?: string }
        Relationships: []
      }
      grm_location_tag_links: {
        Row: { location_id: string; tag_id: string }
        Insert: { location_id: string; tag_id: string }
        Update: { tag_id?: string }
        Relationships: []
      }
      grm_location_managers: {
        Row: { location_id: string; workspace_id: string; user_id: string }
        Insert: { location_id: string; workspace_id: string; user_id: string }
        Update: { user_id?: string }
        Relationships: []
      }
      grm_scope_settings: {
        Row: {
          id: string
          workspace_id: string
          scope: string
          client_id: string | null
          group_id: string | null
          location_id: string | null
          tone_voice: string | null
          tone_note: string | null
          tone: Json | null
          automation: Json | null
          sla_hours: number | null
          routing_level: string | null
          drafts_paused: boolean | null
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          scope: string
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          tone_voice?: string | null
          tone_note?: string | null
          tone?: Json | null
          automation?: Json | null
          sla_hours?: number | null
          routing_level?: string | null
          drafts_paused?: boolean | null
        }
        Update: {
          tone_voice?: string | null
          tone_note?: string | null
          tone?: Json | null
          automation?: Json | null
          sla_hours?: number | null
          routing_level?: string | null
          drafts_paused?: boolean | null
        }
        Relationships: []
      }
      grm_ai_configs: {
        Row: {
          id: string
          workspace_id: string
          version: number
          status: string
          label: string
          snapshot: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          version: number
          status: string
          label?: string
          snapshot?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: string
          label?: string
          snapshot?: Json
          updated_at?: string
        }
        Relationships: []
      }
      grm_ai_knowledge: {
        Row: {
          id: string
          workspace_id: string
          client_id: string | null
          group_id: string | null
          location_id: string | null
          kind: string
          title: string
          body: string
          metadata: Json
          enabled: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          kind: string
          title: string
          body: string
          metadata?: Json
          enabled?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          kind?: string
          title?: string
          body?: string
          metadata?: Json
          enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      grm_reply_settings: {
        Row: { workspace_id: string; tone: Json; automation: Json; updated_at: string }
        Insert: { workspace_id: string; tone?: Json; automation?: Json; updated_at?: string }
        Update: { tone?: Json; automation?: Json; updated_at?: string }
        Relationships: []
      }
      grm_reply_templates: {
        Row: {
          id: string
          workspace_id: string
          name: string
          body: string
          client_id: string | null
          group_id: string | null
          location_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          body: string
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          created_at?: string
        }
        Update: { name?: string; body?: string }
        Relationships: []
      }
      grm_review_ai_drafts: {
        Row: {
          ai_config_version: number | null
          ai_model: string
          ai_prompt_hash: string
          content: string
          created_at: string
          edited_at: string | null
          edited_by: string | null
          edited_content: string | null
          generated_by: string
          generation_id: string | null
          generation_params: Json
          id: string
          prompt_version: string
          review_id: string
          status: Database["public"]["Enums"]["grm_ai_draft_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_config_version?: number | null
          ai_model: string
          ai_prompt_hash: string
          content: string
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          edited_content?: string | null
          generated_by: string
          generation_id?: string | null
          generation_params?: Json
          id?: string
          prompt_version: string
          review_id: string
          status?: Database["public"]["Enums"]["grm_ai_draft_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_config_version?: number | null
          ai_model?: string
          ai_prompt_hash?: string
          content?: string
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          edited_content?: string | null
          generated_by?: string
          generation_id?: string | null
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
          client_approval: string
          content: string
          created_at: string
          created_by: string
          failure_count: number
          id: string
          last_error: string | null
          publish_result: Json | null
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
          client_approval?: string
          content: string
          created_at?: string
          created_by: string
          failure_count?: number
          id?: string
          last_error?: string | null
          publish_result?: Json | null
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
          client_approval?: string
          content?: string
          created_at?: string
          created_by?: string
          failure_count?: number
          id?: string
          last_error?: string | null
          publish_result?: Json | null
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
      grm_review_notes: {
        Row: {
          id: string
          workspace_id: string
          review_id: string
          author_id: string
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          review_id: string
          author_id: string
          body: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          review_id?: string
          author_id?: string
          body?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_review_notes_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "grm_reviews"
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
          review_language: string | null
          complaint_theme: string | null
          assigned_to: string | null
          reopened_at: string | null
          review_create_time: string
          review_update_time: string | null
          review_url: string | null
          reviewer_display_name: string
          reviewer_is_anonymous: boolean
          reviewer_profile_url: string | null
          star_rating: number
          sync_hash: string | null
          content_fingerprint: string | null
          response_fingerprint: string | null
          missing_on_google_at: string | null
          downstream_stale_at: string | null
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
          review_language?: string | null
          complaint_theme?: string | null
          assigned_to?: string | null
          reopened_at?: string | null
          review_create_time: string
          review_update_time?: string | null
          review_url?: string | null
          reviewer_display_name?: string
          reviewer_is_anonymous?: boolean
          reviewer_profile_url?: string | null
          star_rating: number
          sync_hash?: string | null
          content_fingerprint?: string | null
          response_fingerprint?: string | null
          missing_on_google_at?: string | null
          downstream_stale_at?: string | null
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
          review_language?: string | null
          complaint_theme?: string | null
          assigned_to?: string | null
          reopened_at?: string | null
          review_create_time?: string
          review_update_time?: string | null
          review_url?: string | null
          reviewer_display_name?: string
          reviewer_is_anonymous?: boolean
          reviewer_profile_url?: string | null
          star_rating?: number
          sync_hash?: string | null
          content_fingerprint?: string | null
          response_fingerprint?: string | null
          missing_on_google_at?: string | null
          downstream_stale_at?: string | null
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
          scope_client_id: string | null
          scope_group_id: string | null
          scope_location_id: string | null
          status: string
          workspace_id: string
          expires_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["grm_member_role"]
          scope_client_id?: string | null
          scope_group_id?: string | null
          scope_location_id?: string | null
          status?: string
          workspace_id: string
          expires_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          scope_client_id?: string | null
          scope_group_id?: string | null
          scope_location_id?: string | null
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["grm_member_role"]
          status?: string
          workspace_id?: string
          expires_at?: string
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
      grm_onboarding: {
        Row: {
          workspace_id: string
          step: string
          grouping: string | null
          tone_voice: string | null
          tone_note: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          step?: string
          grouping?: string | null
          tone_voice?: string | null
          tone_note?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          step?: string
          grouping?: string | null
          tone_voice?: string | null
          tone_note?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_onboarding_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "grm_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      grm_brands: {
        Row: { id: string; workspace_id: string; client_id: string; name: string }
        Insert: { id?: string; workspace_id: string; client_id: string; name: string }
        Update: { name?: string }
        Relationships: []
      }
      grm_groups: {
        Row: {
          id: string
          workspace_id: string
          client_id: string
          brand_id: string
          parent_id: string | null
          name: string
          kind: string
          sort_order: number
        }
        Insert: {
          id?: string
          workspace_id: string
          client_id: string
          brand_id: string
          parent_id?: string | null
          name: string
          kind?: string
          sort_order?: number
        }
        Update: {
          name?: string
          parent_id?: string | null
          kind?: string
          client_id?: string
          brand_id?: string
        }
        Relationships: []
      }
      grm_location_groups: {
        Row: {
          id: string
          workspace_id: string
          client_id: string | null
          parent_id: string | null
          kind: string
          name: string
          source: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          client_id?: string | null
          parent_id?: string | null
          kind?: string
          name: string
          source: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          client_id?: string | null
          parent_id?: string | null
          kind?: string
          name?: string
          source?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grm_location_groups_workspace_id_fkey"
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
          access_enabled: boolean
          alert_email: boolean
          alert_in_app: boolean
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string
          role: Database["public"]["Enums"]["grm_member_role"]
          scope_client_id: string | null
          scope_group_id: string | null
          scope_location_id: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          access_enabled?: boolean
          alert_email?: boolean
          alert_in_app?: boolean
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["grm_member_role"]
          scope_client_id?: string | null
          scope_group_id?: string | null
          scope_location_id?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          access_enabled?: boolean
          alert_email?: boolean
          alert_in_app?: boolean
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["grm_member_role"]
          scope_client_id?: string | null
          scope_group_id?: string | null
          scope_location_id?: string | null
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
          admin_note: string | null
          ai_monthly_budget_usd: number | null
          created_at: string
          deleted_at: string | null
          feature_flags: Json
          id: string
          max_locations: number | null
          max_members: number | null
          name: string
          plan: string
          plan_expires_at: string | null
          slug: string
          status: string
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          ai_monthly_budget_usd?: number | null
          created_at?: string
          deleted_at?: string | null
          feature_flags?: Json
          id?: string
          max_locations?: number | null
          max_members?: number | null
          name: string
          plan?: string
          plan_expires_at?: string | null
          slug: string
          status?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          ai_monthly_budget_usd?: number | null
          created_at?: string
          deleted_at?: string | null
          feature_flags?: Json
          id?: string
          max_locations?: number | null
          max_members?: number | null
          name?: string
          plan?: string
          plan_expires_at?: string | null
          slug?: string
          status?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      grm_platform_blocked_users: {
        Row: { blocked_by: string | null; created_at: string; email: string; reason: string | null; user_id: string | null }
        Insert: { blocked_by?: string | null; created_at?: string; email: string; reason?: string | null; user_id?: string | null }
        Update: { blocked_by?: string | null; created_at?: string; email?: string; reason?: string | null; user_id?: string | null }
        Relationships: []
      }
      grm_platform_settings: {
        Row: { key: string; updated_at: string; updated_by: string | null; value: Json }
        Insert: { key: string; updated_at?: string; updated_by?: string | null; value?: Json }
        Update: { key?: string; updated_at?: string; updated_by?: string | null; value?: Json }
        Relationships: []
      }
      grm_platform_announcements: {
        Row: { active: boolean; body: string; created_at: string; created_by: string | null; id: string; title: string; tone: string }
        Insert: { active?: boolean; body: string; created_at?: string; created_by?: string | null; id?: string; title: string; tone?: string }
        Update: { active?: boolean; body?: string; created_at?: string; created_by?: string | null; id?: string; title?: string; tone?: string }
        Relationships: []
      }
      grm_access_requests: {
        Row: { company: string | null; created_at: string; decided_at: string | null; decided_by: string | null; email: string; id: string; message: string | null; status: string; user_id: string | null }
        Insert: { company?: string | null; created_at?: string; decided_at?: string | null; decided_by?: string | null; email: string; id?: string; message?: string | null; status?: string; user_id?: string | null }
        Update: { company?: string | null; created_at?: string; decided_at?: string | null; decided_by?: string | null; email?: string; id?: string; message?: string | null; status?: string; user_id?: string | null }
        Relationships: []
      }
      grm_platform_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          note: string | null
          status: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          note?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          note?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      grm_escalation_policies: {
        Row: {
          workspace_id: string
          max_stars: number
          flag_profanity: boolean
          flag_legal_safety: boolean
          extra_keywords: string[]
          reminder_hours: number[]
          due_hours: number
          timezone: string
          resolution_phone: string | null
          resolution_email: string | null
          updated_at: string
        }
        Insert: {
          workspace_id: string
          max_stars?: number
          flag_profanity?: boolean
          flag_legal_safety?: boolean
          extra_keywords?: string[]
          reminder_hours?: number[]
          due_hours?: number
          timezone?: string
          resolution_phone?: string | null
          resolution_email?: string | null
          updated_at?: string
        }
        Update: {
          max_stars?: number
          flag_profanity?: boolean
          flag_legal_safety?: boolean
          extra_keywords?: string[]
          reminder_hours?: number[]
          due_hours?: number
          timezone?: string
          resolution_phone?: string | null
          resolution_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      grm_escalations: {
        Row: {
          id: string
          workspace_id: string
          review_id: string
          location_id: string
          status: string
          level: string
          theme: string | null
          assignee_user_id: string | null
          responsible_user_id: string | null
          ownership: string
          assignment_reason: string | null
          assignment_decided_at: string | null
          sla_advanced_at: string | null
          opened_at: string
          due_at: string
          resolved_at: string | null
          resolved_by: string | null
          resolution_code: string | null
          internal_note: string | null
          trigger_reasons: string[]
          trigger_key: string
          ticket_no: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          review_id: string
          location_id: string
          status?: string
          level?: string
          theme?: string | null
          assignee_user_id?: string | null
          responsible_user_id?: string | null
          ownership?: string
          assignment_reason?: string | null
          assignment_decided_at?: string | null
          sla_advanced_at?: string | null
          opened_at: string
          due_at: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolution_code?: string | null
          internal_note?: string | null
          trigger_reasons: string[]
          trigger_key: string
          ticket_no?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: string
          level?: string
          theme?: string | null
          assignee_user_id?: string | null
          responsible_user_id?: string | null
          ownership?: string
          assignment_reason?: string | null
          assignment_decided_at?: string | null
          sla_advanced_at?: string | null
          opened_at?: string
          due_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolution_code?: string | null
          internal_note?: string | null
          trigger_reasons?: string[]
          trigger_key?: string
          ticket_no?: number
          updated_at?: string
        }
        Relationships: []
      }
      grm_analysis_runs: {
        Row: {
          id: string
          workspace_id: string
          requested_by: string | null
          client_id: string | null
          group_id: string | null
          location_id: string | null
          range_start: string | null
          range_end: string | null
          status: string
          discovered: number
          eligible: number
          already_analysed: number
          newly_analysed: number
          pending: number
          failed: number
          batches_total: number
          batches_completed: number
          retries: number
          input_tokens: number
          output_tokens: number
          error: string | null
          started_at: string
          finished_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          requested_by?: string | null
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          range_start?: string | null
          range_end?: string | null
          status?: string
          discovered?: number
          eligible?: number
          already_analysed?: number
          newly_analysed?: number
          pending?: number
          failed?: number
          batches_total?: number
          batches_completed?: number
          retries?: number
          input_tokens?: number
          output_tokens?: number
          error?: string | null
          started_at?: string
          finished_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: string
          discovered?: number
          eligible?: number
          already_analysed?: number
          newly_analysed?: number
          pending?: number
          failed?: number
          batches_total?: number
          batches_completed?: number
          retries?: number
          input_tokens?: number
          output_tokens?: number
          error?: string | null
          finished_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }

      grm_insight_reports: {
        Row: {
          id: string
          workspace_id: string
          cache_key: string
          requested_by: string | null
          client_id: string | null
          group_id: string | null
          location_id: string | null
          location_ids: string[]
          range_start: string | null
          range_end: string | null
          status: string
          phase: string | null
          insights: unknown
          evidence_summary: unknown
          limitations: string[]
          data_fingerprint: string | null
          analysis_version: string
          prompt_version: string
          model: string | null
          discovered_count: number
          eligible_count: number
          analysed_count: number
          failed_count: number
          pending_count: number
          failed_review_ids: string[]
          input_tokens: number
          output_tokens: number
          error: string | null
          started_at: string | null
          finished_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          cache_key: string
          requested_by?: string | null
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          location_ids?: string[]
          range_start?: string | null
          range_end?: string | null
          status?: string
          phase?: string | null
          insights?: unknown
          evidence_summary?: unknown
          limitations?: string[]
          data_fingerprint?: string | null
          analysis_version: string
          prompt_version: string
          model?: string | null
          discovered_count?: number
          eligible_count?: number
          analysed_count?: number
          failed_count?: number
          pending_count?: number
          failed_review_ids?: string[]
          input_tokens?: number
          output_tokens?: number
          error?: string | null
          started_at?: string | null
          finished_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: string
          phase?: string | null
          insights?: unknown
          evidence_summary?: unknown
          limitations?: string[]
          data_fingerprint?: string | null
          model?: string | null
          discovered_count?: number
          eligible_count?: number
          analysed_count?: number
          failed_count?: number
          pending_count?: number
          failed_review_ids?: string[]
          input_tokens?: number
          output_tokens?: number
          error?: string | null
          started_at?: string | null
          finished_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      grm_review_analyses: {
        Row: {
          id: string
          workspace_id: string
          review_id: string
          location_id: string
          analysis_version: string
          content_fingerprint: string
          status: string
          model: string | null
          observation_count: number
          error: string | null
          processed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          review_id: string
          location_id: string
          analysis_version: string
          content_fingerprint: string
          status?: string
          model?: string | null
          observation_count?: number
          error?: string | null
          processed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: string
          model?: string | null
          observation_count?: number
          content_fingerprint?: string
          error?: string | null
          processed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      grm_review_observations: {
        Row: {
          id: string
          workspace_id: string
          analysis_id: string
          review_id: string
          location_id: string
          client_id: string | null
          group_id: string | null
          review_create_time: string
          star_rating: number
          language: string | null
          topic: string
          subtopic: string | null
          sentiment: string
          detail: string
          entity_type: string | null
          entity_name: string | null
          severity: number | null
          severity_rationale: string | null
          evidence_excerpt: string
          evidence_start: number | null
          evidence_end: number | null
          basis: string
          confidence: number | null
          is_ambiguous: boolean
          dedupe_key: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          analysis_id: string
          review_id: string
          location_id: string
          client_id?: string | null
          group_id?: string | null
          review_create_time: string
          star_rating: number
          language?: string | null
          topic: string
          subtopic?: string | null
          sentiment: string
          detail: string
          entity_type?: string | null
          entity_name?: string | null
          severity?: number | null
          severity_rationale?: string | null
          evidence_excerpt: string
          evidence_start?: number | null
          evidence_end?: number | null
          basis?: string
          confidence?: number | null
          is_ambiguous?: boolean
          dedupe_key: string
          created_at?: string
        }
        Update: {
          topic?: string
          subtopic?: string | null
          sentiment?: string
          detail?: string
          entity_type?: string | null
          entity_name?: string | null
          severity?: number | null
          severity_rationale?: string | null
          evidence_excerpt?: string
          evidence_start?: number | null
          evidence_end?: number | null
          basis?: string
          confidence?: number | null
          is_ambiguous?: boolean
        }
        Relationships: []
      }
      grm_notifications: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          location_id: string | null
          kind: string
          title: string
          href: string
          dedupe_key: string
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id: string
          location_id?: string | null
          kind: string
          title: string
          href: string
          dedupe_key: string
          read_at?: string | null
          created_at?: string
        }
        Update: {
          title?: string
          href?: string
          read_at?: string | null
        }
        Relationships: []
      }
      grm_escalation_events: {
        Row: {
          id: string
          workspace_id: string
          escalation_id: string
          actor_id: string | null
          kind: string
          body: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          escalation_id: string
          actor_id?: string | null
          kind: string
          body: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          kind?: string
          body?: string
          metadata?: Json
        }
        Relationships: []
      }
      grm_escalation_reminders: {
        Row: {
          id: string
          workspace_id: string
          escalation_id: string
          kind: string
          due_at: string
          sent_at: string | null
          attempts: number
          last_error: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          escalation_id: string
          kind: string
          due_at: string
          sent_at?: string | null
          attempts?: number
          last_error?: string | null
        }
        Update: {
          sent_at?: string | null
          attempts?: number
          last_error?: string | null
        }
        Relationships: []
      }
      grm_autoreply_pauses: {
        Row: {
          id: string
          workspace_id: string
          scope: string
          client_id: string | null
          location_id: string | null
          paused_by: string
          paused_at: string
          cleared_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          scope: string
          client_id?: string | null
          location_id?: string | null
          paused_by: string
          paused_at?: string
          cleared_at?: string | null
        }
        Update: {
          cleared_at?: string | null
        }
        Relationships: []
      }
      grm_reports: {
        Row: {
          id: string
          workspace_id: string
          name: string
          client_id: string | null
          group_id: string | null
          location_id: string | null
          sections: string[]
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          sections?: string[]
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          sections?: string[]
        }
        Relationships: []
      }
      grm_report_schedules: {
        Row: {
          id: string
          workspace_id: string
          name: string
          client_id: string | null
          group_id: string | null
          location_id: string | null
          sections: string[]
          frequency: string
          delivery_time: string
          timezone: string
          weekday: number | null
          day_of_month: number | null
          recipient_emails: string[]
          recipients: string
          channels: string[]
          channel: string
          enabled: boolean
          next_run_at: string
          scope_label: string | null
          include_scorecard: boolean
          include_leaderboard: boolean
          include_themes: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          sections?: string[]
          frequency: string
          delivery_time?: string
          timezone?: string
          weekday?: number | null
          day_of_month?: number | null
          recipient_emails?: string[]
          recipients?: string
          channels?: string[]
          channel?: string
          enabled?: boolean
          next_run_at?: string
          scope_label?: string | null
          include_scorecard?: boolean
          include_leaderboard?: boolean
          include_themes?: boolean
          created_by?: string | null
        }
        Update: {
          name?: string
          workspace_id?: string
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          sections?: string[]
          frequency?: string
          delivery_time?: string
          timezone?: string
          weekday?: number | null
          day_of_month?: number | null
          recipient_emails?: string[]
          recipients?: string
          channels?: string[]
          channel?: string
          enabled?: boolean
          next_run_at?: string
          scope_label?: string | null
          include_scorecard?: boolean
          include_leaderboard?: boolean
          include_themes?: boolean
          created_by?: string | null
        }
        Relationships: []
      }
      grm_report_runs: {
        Row: {
          id: string
          workspace_id: string
          schedule_id: string | null
          trigger: string
          slot: string | null
          status: string
          attempts: number
          period_start: string
          period_end: string
          summary: string | null
          snapshot: Json
          error: string | null
          started_at: string
          finished_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          schedule_id?: string | null
          trigger: string
          slot?: string | null
          status: string
          attempts?: number
          period_start: string
          period_end: string
          summary?: string | null
          snapshot?: Json
          error?: string | null
          started_at?: string
          finished_at?: string | null
        }
        Update: {
          status?: string
          attempts?: number
          summary?: string | null
          snapshot?: Json
          error?: string | null
          started_at?: string
          finished_at?: string | null
        }
        Relationships: []
      }
      grm_report_deliveries: {
        Row: {
          id: string
          run_id: string
          workspace_id: string
          channel: string
          recipient: string
          status: string
          detail: string | null
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          workspace_id: string
          channel: string
          recipient: string
          status: string
          detail?: string | null
        }
        Update: {
          status?: string
          detail?: string | null
        }
        Relationships: []
      }
      grm_alert_rules: {
        Row: {
          id: string
          workspace_id: string
          name: string
          kind: string
          client_id: string | null
          group_id: string | null
          location_id: string | null
          enabled: boolean
          recipient_emails: string[]
          channels: string[]
          channel: string
          scope_label: string | null
          notify_label: string | null
          threshold: number
          window_days: number
          min_reviews: number
          drop_points: number
          multiplier: number
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          kind: string
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          enabled?: boolean
          recipient_emails?: string[]
          channels?: string[]
          channel?: string
          scope_label?: string | null
          notify_label?: string | null
          threshold?: number
          window_days?: number
          min_reviews?: number
          drop_points?: number
          multiplier?: number
          created_by?: string | null
        }
        Update: {
          name?: string
          kind?: string
          client_id?: string | null
          group_id?: string | null
          location_id?: string | null
          enabled?: boolean
          recipient_emails?: string[]
          channels?: string[]
          channel?: string
          scope_label?: string | null
          notify_label?: string | null
          threshold?: number
          window_days?: number
          min_reviews?: number
          drop_points?: number
          multiplier?: number
        }
        Relationships: []
      }
      grm_alert_events: {
        Row: {
          id: string
          workspace_id: string
          rule_id: string
          dedupe_key: string
          location_id: string | null
          summary: string
          evidence: Json
          fingerprint: string
          delivery: string
          triggered_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          rule_id: string
          dedupe_key?: string | null
          fingerprint: string
          location_id?: string | null
          summary: string
          evidence?: Json
          delivery?: string
        }
        Update: {
          summary?: string
        }
        Relationships: []
      }
      grm_alert_deliveries: {
        Row: {
          id: string
          event_id: string
          workspace_id: string
          channel: string
          recipient: string
          status: string
          detail: string | null
          created_at: string
        }
        Insert: {
          id?: string
          event_id: string
          workspace_id: string
          channel: string
          recipient: string
          status: string
          detail?: string | null
        }
        Update: {
          status?: string
          detail?: string | null
        }
        Relationships: []
      }
      grm_request_policies: {
        Row: { workspace_id: string; cooldown_days: number; updated_at: string }
        Insert: { workspace_id: string; cooldown_days?: number }
        Update: { cooldown_days?: number }
        Relationships: []
      }
      grm_request_campaigns: {
        Row: {
          id: string
          workspace_id: string
          name: string
          channel: string
          language: string
          template: string
          reminder_enabled: boolean
          reminder_after_days: number
          status: string
          source: string
          preview_eligible: number
          preview_suppressed: number
          preview_opted_out: number
          preview_missing_contact: number
          preview_unknown_store: number
          preview_duplicates: number
          created_by: string | null
          created_at: string
          updated_at: string
          sent_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          channel: string
          language: string
          template?: string
          reminder_enabled?: boolean
          reminder_after_days?: number
          status?: string
          source?: string
          preview_eligible?: number
          preview_suppressed?: number
          preview_opted_out?: number
          preview_missing_contact?: number
          preview_unknown_store?: number
          preview_duplicates?: number
          created_by?: string | null
        }
        Update: {
          status?: string
          template?: string
          language?: string
          reminder_enabled?: boolean
          sent_at?: string | null
          preview_eligible?: number
          preview_suppressed?: number
          preview_opted_out?: number
          preview_missing_contact?: number
          preview_unknown_store?: number
          preview_duplicates?: number
        }
        Relationships: []
      }
      grm_request_campaign_locations: {
        Row: { campaign_id: string; location_id: string }
        Insert: { campaign_id: string; location_id: string }
        Update: { location_id?: string }
        Relationships: []
      }
      grm_request_customers: {
        Row: {
          id: string
          workspace_id: string
          name: string
          email: string | null
          phone: string | null
          phone_key: string | null
          location_id: string | null
          dedupe_key: string
          opted_out_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name?: string
          email?: string | null
          phone?: string | null
          phone_key?: string | null
          location_id?: string | null
          dedupe_key: string
          opted_out_at?: string | null
        }
        Update: {
          name?: string
          email?: string | null
          phone?: string | null
          phone_key?: string | null
          location_id?: string | null
          opted_out_at?: string | null
        }
        Relationships: []
      }
      grm_request_recipients: {
        Row: { campaign_id: string; customer_id: string; location_id: string | null; decision: string }
        Insert: { campaign_id: string; customer_id: string; location_id?: string | null; decision: string }
        Update: { decision?: string; location_id?: string | null }
        Relationships: []
      }
      grm_request_messages: {
        Row: {
          id: string
          workspace_id: string
          campaign_id: string | null
          customer_id: string | null
          location_id: string | null
          channel: string
          token: string
          status: string
          is_test: boolean
          is_reminder: boolean
          reminder_of: string | null
          attempts: number
          retryable: boolean
          provider_ref: string | null
          error: string | null
          queued_at: string | null
          accepted_at: string | null
          delivered_at: string | null
          opened_at: string | null
          clicked_at: string | null
          google_clicked_at: string | null
          next_attempt_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          campaign_id?: string | null
          customer_id?: string | null
          location_id?: string | null
          channel: string
          token: string
          status: string
          is_test?: boolean
          is_reminder?: boolean
          reminder_of?: string | null
          attempts?: number
          retryable?: boolean
          provider_ref?: string | null
          error?: string | null
          queued_at?: string | null
          accepted_at?: string | null
          delivered_at?: string | null
          opened_at?: string | null
          clicked_at?: string | null
          google_clicked_at?: string | null
          next_attempt_at?: string | null
        }
        Update: {
          status?: string
          attempts?: number
          retryable?: boolean
          provider_ref?: string | null
          error?: string | null
          accepted_at?: string | null
          delivered_at?: string | null
          opened_at?: string | null
          clicked_at?: string | null
          google_clicked_at?: string | null
          next_attempt_at?: string | null
        }
        Relationships: []
      }
      grm_request_qr: {
        Row: { id: string; workspace_id: string; location_id: string; token: string; language: string; created_at: string }
        Insert: { id?: string; workspace_id: string; location_id: string; token: string; language?: string }
        Update: { language?: string }
        Relationships: []
      }
      grm_request_events: {
        Row: {
          id: string
          workspace_id: string
          message_id: string | null
          qr_id: string | null
          kind: string
          detail: string | null
          created_at: string
        }
        Insert: {
          workspace_id: string
          message_id?: string | null
          qr_id?: string | null
          kind: string
          detail?: string | null
        }
        Update: { detail?: string | null }
        Relationships: []
      }
      grm_request_feedback: {
        Row: {
          id: string
          workspace_id: string
          location_id: string | null
          message_id: string | null
          qr_id: string | null
          body: string
          created_at: string
        }
        Insert: {
          workspace_id: string
          location_id?: string | null
          message_id?: string | null
          qr_id?: string | null
          body: string
        }
        Update: { body?: string }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      grm_my_workspace_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      grm_can_see_scope_summary: {
        Args: {
          p_workspace: string
          p_scope_type: string
          p_client: string
          p_group: string | null
          p_location: string | null
          p_parent_group: string | null
        }
        Returns: boolean
      }
      grm_location_review_counts: {
        Args: { p_workspace_id: string; p_start?: string | null; p_end?: string | null }
        Returns: { location_id: string; review_count: number }[]
      }
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
        Args: {
          p_workspace_id: string
          p_months?: number | null
          p_client_id?: string | null
          p_location_id?: string | null
          p_start?: string | null
          p_end?: string | null
        }
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
      grm_dashboard_bundle: {
        Args: {
          p_workspace_id: string
          p_client_id?: string | null
          p_group_id?: string | null
          p_location_id?: string | null
          p_start?: string | null
          p_end?: string | null
          p_timezone?: string
        }
        Returns: Json
      }
      grm_alert_location_window: {
        Args: {
          p_workspace_id: string
          p_client_id?: string | null
          p_group_id?: string | null
          p_location_id?: string | null
          p_start: string
          p_end: string
        }
        Returns: Json
      }
      grm_agency_counts: {
        Args: {
          p_workspace_id: string
          p_start?: string | null
          p_end?: string | null
        }
        Returns: Json
      }
      grm_overview_signals: {
        Args: {
          p_workspace_id: string
          p_location_ids: string[]
          p_start?: string | null
          p_end?: string | null
          p_recent_start?: string | null
          p_recent_end?: string | null
          p_now?: string
        }
        Returns: Json
      }
      grm_analytics_summary: {
        Args: {
          p_workspace_id: string
          p_location_ids: string[]
          p_start?: string | null
          p_end?: string | null
          p_include_auto?: boolean
        }
        Returns: Json
      }
      grm_analytics_slice: {
        Args: {
          p_workspace_id: string
          p_location_ids: string[]
          p_start?: string | null
          p_end?: string | null
          p_onboarding_completed_at?: string | null
        }
        Returns: Json
      }
      grm_shell_profile_attention: {
        Args: {
          p_workspace_id: string
          p_location_ids: string[]
        }
        Returns: Json
      }
      grm_insight_dashboard: {
        Args: {
          p_workspace_id: string
          p_location_ids: string[]
          p_start?: string | null
          p_end?: string | null
          p_analysis_version?: string
        }
        Returns: Json
      }
      grm_star_breakdown: {
        Args: {
          p_workspace_id: string
          p_location_ids: string[]
          p_start?: string | null
          p_end?: string | null
          p_timezone?: string
        }
        Returns: {
          month: string
          location_id: string
          star_rating: number | null
          complaint_theme: string | null
          review_count: number
        }[]
      }
      grm_request_board: { Args: { p_workspace: string }; Returns: Json }
      grm_alert_keyword_reviews: {
        Args: {
          p_workspace_id: string
          p_client_id?: string | null
          p_group_id?: string | null
          p_location_id?: string | null
          p_start: string
          p_end: string
          p_keywords: string[]
        }
        Returns: Json
      }
    }
    Enums: {
      grm_ai_draft_status: "generated" | "edited" | "discarded"
      grm_connection_status: "active" | "expired" | "revoked"
      grm_member_role:
        | "owner"
        | "admin"
        | "member"
        | "org_admin"
        | "brand_manager"
        | "group_manager"
        | "store_manager"
        | "agent"
        | "auditor"
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
