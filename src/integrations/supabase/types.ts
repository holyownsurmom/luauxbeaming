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
      admins: {
        Row: {
          created_at: string
          discord_id: string
          note: string | null
        }
        Insert: {
          created_at?: string
          discord_id: string
          note?: string | null
        }
        Update: {
          created_at?: string
          discord_id?: string
          note?: string | null
        }
        Relationships: []
      }
      blacklisted_users: {
        Row: {
          created_at: string | null
          discord_id: string
          reason: string | null
        }
        Insert: {
          created_at?: string | null
          discord_id: string
          reason?: string | null
        }
        Update: {
          created_at?: string | null
          discord_id?: string
          reason?: string | null
        }
        Relationships: []
      }
      bot_jobs: {
        Row: {
          config: Json
          created_at: string
          discord_id: string
          error: string | null
          id: string
          started_at: string | null
          status: string
          stopped_at: string | null
          type: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          config: Json
          created_at?: string
          discord_id: string
          error?: string | null
          id?: string
          started_at?: string | null
          status?: string
          stopped_at?: string | null
          type: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          discord_id?: string
          error?: string | null
          id?: string
          started_at?: string | null
          status?: string
          stopped_at?: string | null
          type?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      bot_logs: {
        Row: {
          created_at: string
          discord_id: string
          id: number
          job_id: string
          level: string
          message: string
        }
        Insert: {
          created_at?: string
          discord_id: string
          id?: number
          job_id: string
          level: string
          message: string
        }
        Update: {
          created_at?: string
          discord_id?: string
          id?: number
          job_id?: string
          level?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "bot_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mc_accounts: {
        Row: {
          auth_type: string
          created_at: string
          discord_id: string
          id: string
          label: string
          ssid: string | null
          status: string
          username: string | null
          uuid: string | null
        }
        Insert: {
          auth_type: string
          created_at?: string
          discord_id: string
          id?: string
          label: string
          ssid?: string | null
          status?: string
          username?: string | null
          uuid?: string | null
        }
        Update: {
          auth_type?: string
          created_at?: string
          discord_id?: string
          id?: string
          label?: string
          ssid?: string | null
          status?: string
          username?: string | null
          uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mc_accounts_discord_id_fkey"
            columns: ["discord_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["discord_id"]
          },
        ]
      }
      payments: {
        Row: {
          confirmations: number
          created_at: string
          discord_id: string
          id: string
          np_order_id: string
          np_payment_id: string | null
          pay_address: string | null
          pay_amount: number | null
          pay_currency: string
          plan_id: string
          price_amount: number
          raw_payload: Json | null
          required_confirmations: number
          status: string
          updated_at: string
        }
        Insert: {
          confirmations?: number
          created_at?: string
          discord_id: string
          id?: string
          np_order_id: string
          np_payment_id?: string | null
          pay_address?: string | null
          pay_amount?: number | null
          pay_currency: string
          plan_id: string
          price_amount: number
          raw_payload?: Json | null
          required_confirmations?: number
          status?: string
          updated_at?: string
        }
        Update: {
          confirmations?: number
          created_at?: string
          discord_id?: string
          id?: string
          np_order_id?: string
          np_payment_id?: string | null
          pay_address?: string | null
          pay_amount?: number | null
          pay_currency?: string
          plan_id?: string
          price_amount?: number
          raw_payload?: Json | null
          required_confirmations?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_discord_id_fkey"
            columns: ["discord_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["discord_id"]
          },
          {
            foreignKeyName: "payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          bot_hours: number
          created_at: string
          duration_days: number
          features: Json
          id: string
          kind: string
          max_bots: number
          name: string
          price_usd: number
          sort_order: number
        }
        Insert: {
          bot_hours: number
          created_at?: string
          duration_days: number
          features?: Json
          id: string
          kind?: string
          max_bots: number
          name: string
          price_usd: number
          sort_order?: number
        }
        Update: {
          bot_hours?: number
          created_at?: string
          duration_days?: number
          features?: Json
          id?: string
          kind?: string
          max_bots?: number
          name?: string
          price_usd?: number
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_plan_id: string | null
          avatar_url: string | null
          bot_hours_remaining: number
          created_at: string
          discord_id: string
          email: string | null
          global_name: string | null
          plan_expires_at: string | null
          updated_at: string
          username: string
        }
        Insert: {
          active_plan_id?: string | null
          avatar_url?: string | null
          bot_hours_remaining?: number
          created_at?: string
          discord_id: string
          email?: string | null
          global_name?: string | null
          plan_expires_at?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          active_plan_id?: string | null
          avatar_url?: string | null
          bot_hours_remaining?: number
          created_at?: string
          discord_id?: string
          email?: string | null
          global_name?: string | null
          plan_expires_at?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_plan_id_fkey"
            columns: ["active_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_keys: {
        Row: {
          created_at: string
          delivered: boolean
          discord_id: string
          expires_at: string
          id: string
          key: string
          plugin_id: string
          source_payment_id: string | null
        }
        Insert: {
          created_at?: string
          delivered?: boolean
          discord_id: string
          expires_at: string
          id?: string
          key: string
          plugin_id?: string
          source_payment_id?: string | null
        }
        Update: {
          created_at?: string
          delivered?: boolean
          discord_id?: string
          expires_at?: string
          id?: string
          key?: string
          plugin_id?: string
          source_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_keys_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
