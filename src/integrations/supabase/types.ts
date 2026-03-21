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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ai_fills: {
        Row: {
          created_at: string | null
          duration: number | null
          edit_decision_id: string
          gap_index: number
          generation_time_ms: number | null
          id: string
          method: string
          provider: string | null
          quality_score: number | null
          s3_key: string | null
        }
        Insert: {
          created_at?: string | null
          duration?: number | null
          edit_decision_id: string
          gap_index: number
          generation_time_ms?: number | null
          id?: string
          method: string
          provider?: string | null
          quality_score?: number | null
          s3_key?: string | null
        }
        Update: {
          created_at?: string | null
          duration?: number | null
          edit_decision_id?: string
          gap_index?: number
          generation_time_ms?: number | null
          id?: string
          method?: string
          provider?: string | null
          quality_score?: number | null
          s3_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_fills_edit_decision_id_fkey"
            columns: ["edit_decision_id"]
            isOneToOne: false
            referencedRelation: "edit_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string | null
          id: string
          input_hash: string | null
          metadata: Json | null
          output_hash: string | null
          provider: string | null
          quality_score: number | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          input_hash?: string | null
          metadata?: Json | null
          output_hash?: string | null
          provider?: string | null
          quality_score?: number | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          input_hash?: string | null
          metadata?: Json | null
          output_hash?: string | null
          provider?: string | null
          quality_score?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          created_at: string | null
          credits_granted: number
          credits_remaining: number
          expires_at: string
          granted_at: string
          id: string
          revenuecat_event_id: string | null
          stripe_payment_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          credits_granted: number
          credits_remaining: number
          expires_at: string
          granted_at?: string
          id?: string
          revenuecat_event_id?: string | null
          stripe_payment_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          credits_granted?: number
          credits_remaining?: number
          expires_at?: string
          granted_at?: string
          id?: string
          revenuecat_event_id?: string | null
          stripe_payment_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          created_at: string | null
          credits: number
          id: string
          ledger_entries: Json
          project_id: string | null
          reason: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          credits: number
          id?: string
          ledger_entries?: Json
          project_id?: string | null
          reason?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          credits?: number
          id?: string
          ledger_entries?: Json
          project_id?: string | null
          reason?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cut_maps: {
        Row: {
          created_at: string | null
          cuts_json: Json
          id: string
          transcript_json: Json | null
          version: number
          video_id: string
        }
        Insert: {
          created_at?: string | null
          cuts_json?: Json
          id?: string
          transcript_json?: Json | null
          version?: number
          video_id: string
        }
        Update: {
          created_at?: string | null
          cuts_json?: Json
          id?: string
          transcript_json?: Json | null
          version?: number
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cut_maps_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      edit_decisions: {
        Row: {
          created_at: string | null
          credit_transaction_id: string | null
          credits_charged: number
          edl_json: Json
          id: string
          project_id: string
          status: string
          total_fill_seconds: number
        }
        Insert: {
          created_at?: string | null
          credit_transaction_id?: string | null
          credits_charged?: number
          edl_json: Json
          id?: string
          project_id: string
          status?: string
          total_fill_seconds?: number
        }
        Update: {
          created_at?: string | null
          credit_transaction_id?: string | null
          credits_charged?: number
          edl_json?: Json
          id?: string
          project_id?: string
          status?: string
          total_fill_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "edit_decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_edit_decisions_credit_transaction"
            columns: ["credit_transaction_id"]
            isOneToOne: false
            referencedRelation: "credit_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      exports: {
        Row: {
          c2pa_signed: boolean
          created_at: string | null
          download_url: string | null
          duration: number | null
          edit_decision_id: string | null
          file_size_bytes: number | null
          fill_summary_json: Json | null
          format: string
          id: string
          project_id: string
          resolution: string | null
          s3_key: string
          watermarked: boolean
        }
        Insert: {
          c2pa_signed?: boolean
          created_at?: string | null
          download_url?: string | null
          duration?: number | null
          edit_decision_id?: string | null
          file_size_bytes?: number | null
          fill_summary_json?: Json | null
          format?: string
          id?: string
          project_id: string
          resolution?: string | null
          s3_key: string
          watermarked?: boolean
        }
        Update: {
          c2pa_signed?: boolean
          created_at?: string | null
          download_url?: string | null
          duration?: number | null
          edit_decision_id?: string | null
          file_size_bytes?: number | null
          fill_summary_json?: Json | null
          format?: string
          id?: string
          project_id?: string
          resolution?: string | null
          s3_key?: string
          watermarked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "exports_edit_decision_id_fkey"
            columns: ["edit_decision_id"]
            isOneToOne: false
            referencedRelation: "edit_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      job_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          max_attempts: number
          payload: Json
          priority: number
          progress_percent: number
          project_id: string | null
          started_at: string | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          max_attempts?: number
          payload?: Json
          priority?: number
          progress_percent?: number
          project_id?: string | null
          started_at?: string | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          max_attempts?: number
          payload?: Json
          priority?: number
          progress_percent?: number
          project_id?: string | null
          started_at?: string | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_queue_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          status: string
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          status?: string
          title?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          status?: string
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      speaker_models: {
        Row: {
          created_at: string | null
          embedding_s3_key: string
          expires_at: string
          id: string
          user_id: string
          video_id: string | null
        }
        Insert: {
          created_at?: string | null
          embedding_s3_key: string
          expires_at: string
          id?: string
          user_id: string
          video_id?: string | null
        }
        Update: {
          created_at?: string | null
          embedding_s3_key?: string
          expires_at?: string
          id?: string
          user_id?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "speaker_models_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speaker_models_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          revenuecat_id: string | null
          supabase_uid: string
          tier: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id: string
          revenuecat_id?: string | null
          supabase_uid: string
          tier?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          revenuecat_id?: string | null
          supabase_uid?: string
          tier?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      videos: {
        Row: {
          created_at: string | null
          duration: number | null
          file_size_bytes: number | null
          format: string | null
          id: string
          project_id: string
          proxy_s3_key: string | null
          resolution: string | null
          s3_key: string
          thumbnail_sprite_s3_key: string | null
          waveform_s3_key: string | null
        }
        Insert: {
          created_at?: string | null
          duration?: number | null
          file_size_bytes?: number | null
          format?: string | null
          id?: string
          project_id: string
          proxy_s3_key?: string | null
          resolution?: string | null
          s3_key: string
          thumbnail_sprite_s3_key?: string | null
          waveform_s3_key?: string | null
        }
        Update: {
          created_at?: string | null
          duration?: number | null
          file_size_bytes?: number | null
          format?: string | null
          id?: string
          project_id?: string
          proxy_s3_key?: string | null
          resolution?: string | null
          s3_key?: string
          thumbnail_sprite_s3_key?: string | null
          waveform_s3_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "videos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      deduct_credits: {
        Args: {
          p_project_id?: string
          p_reason?: string
          p_required_credits: number
          p_user_id: string
        }
        Returns: {
          out_credits_remaining: number
          out_message: string
          out_success: boolean
          out_transaction_id: string
        }[]
      }
      refund_credits: {
        Args: { p_credits_to_refund?: number; p_transaction_id: string }
        Returns: {
          out_credits_refunded: number
          out_message: string
          out_success: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
