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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_value: Json | null
          old_value: Json | null
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
        }
        Relationships: []
      }
      command_log: {
        Row: {
          actor_id: string | null
          command: string
          created_at: string
          id: string
          idempotency_key: string
          payload_hash: string | null
          result_ref: string | null
        }
        Insert: {
          actor_id?: string | null
          command: string
          created_at?: string
          id?: string
          idempotency_key: string
          payload_hash?: string | null
          result_ref?: string | null
        }
        Update: {
          actor_id?: string | null
          command?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          payload_hash?: string | null
          result_ref?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          normalized_name: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          normalized_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          normalized_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      graphic_assets: {
        Row: {
          byte_size: number
          checksum: string | null
          content_type: string
          filename: string
          id: string
          is_current: boolean
          order_id: string
          revision_no: number
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          byte_size: number
          checksum?: string | null
          content_type: string
          filename: string
          id?: string
          is_current?: boolean
          order_id: string
          revision_no: number
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          byte_size?: number
          checksum?: string | null
          content_type?: string
          filename?: string
          id?: string
          is_current?: boolean
          order_id?: string
          revision_no?: number
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "graphic_assets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      graphic_upload_sessions: {
        Row: {
          cleaned_at: string | null
          consumed_at: string | null
          created_at: string
          expected_revision: number
          id: string
          order_id: string
          storage_path: string
          user_id: string
        }
        Insert: {
          cleaned_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expected_revision: number
          id?: string
          order_id: string
          storage_path: string
          user_id: string
        }
        Update: {
          cleaned_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expected_revision?: number
          id?: string
          order_id?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "graphic_upload_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      machines: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          station_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          station_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          station_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "machines_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          closure_status: Database["public"]["Enums"]["order_closure_status"]
          created_at: string
          created_by: string | null
          critical_note: string | null
          customer_id: string
          due_on: string
          graphic_status: Database["public"]["Enums"]["graphic_status"]
          id: string
          name: string
          nominal_circumference_mm: number
          normalized_work_order_no: string | null
          note: string | null
          ordered_on: string
          priority: Database["public"]["Enums"]["order_priority"]
          quantity: number
          row_version: number
          supply_status: Database["public"]["Enums"]["supply_status"]
          target_length_mm: number
          updated_at: string
          updated_by: string | null
          work_order_no: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          closure_status?: Database["public"]["Enums"]["order_closure_status"]
          created_at?: string
          created_by?: string | null
          critical_note?: string | null
          customer_id: string
          due_on: string
          graphic_status?: Database["public"]["Enums"]["graphic_status"]
          id?: string
          name: string
          nominal_circumference_mm: number
          normalized_work_order_no?: string | null
          note?: string | null
          ordered_on?: string
          priority?: Database["public"]["Enums"]["order_priority"]
          quantity: number
          row_version?: number
          supply_status?: Database["public"]["Enums"]["supply_status"]
          target_length_mm: number
          updated_at?: string
          updated_by?: string | null
          work_order_no: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          closure_status?: Database["public"]["Enums"]["order_closure_status"]
          created_at?: string
          created_by?: string | null
          critical_note?: string | null
          customer_id?: string
          due_on?: string
          graphic_status?: Database["public"]["Enums"]["graphic_status"]
          id?: string
          name?: string
          nominal_circumference_mm?: number
          normalized_work_order_no?: string | null
          note?: string | null
          ordered_on?: string
          priority?: Database["public"]["Enums"]["order_priority"]
          quantity?: number
          row_version?: number
          supply_status?: Database["public"]["Enums"]["supply_status"]
          target_length_mm?: number
          updated_at?: string
          updated_by?: string | null
          work_order_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          code: string
          label: string
        }
        Insert: {
          category?: string
          code: string
          label: string
        }
        Update: {
          category?: string
          code?: string
          label?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_code: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          permission_code: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          permission_code?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
        ]
      }
      stations: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      user_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"] | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
        }
        Relationships: []
      }
      user_permission_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          granted: boolean
          id: string
          permission_code: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          granted: boolean
          id?: string
          permission_code: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          granted?: boolean
          id?: string
          permission_code?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permission_overrides_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_station_scopes: {
        Row: {
          created_at: string
          id: string
          station_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          station_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          station_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_station_scopes_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_create_customer: { Args: { _name: string }; Returns: string }
      admin_create_machine: {
        Args: { _code: string; _name: string; _station_id: string }
        Returns: string
      }
      admin_create_station: {
        Args: { _code: string; _name: string; _sort_order?: number }
        Returns: string
      }
      admin_invite_user: {
        Args: {
          _email: string
          _full_name?: string
          _role?: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      admin_revoke_invite: { Args: { _invite_id: string }; Returns: undefined }
      admin_set_customer_active: {
        Args: { _active: boolean; _customer_id: string }
        Returns: undefined
      }
      admin_set_machine_active: {
        Args: { _active: boolean; _machine_id: string }
        Returns: undefined
      }
      admin_set_permission_override: {
        Args: {
          _granted: boolean
          _permission_code: string
          _reason?: string
          _user_id: string
        }
        Returns: undefined
      }
      admin_set_station_active: {
        Args: { _active: boolean; _station_id: string }
        Returns: undefined
      }
      admin_set_station_scope: {
        Args: {
          _on: boolean
          _reason?: string
          _station_id: string
          _user_id: string
        }
        Returns: undefined
      }
      admin_set_user_active: {
        Args: { _active: boolean; _reason?: string; _user_id: string }
        Returns: undefined
      }
      admin_set_user_role: {
        Args: {
          _on: boolean
          _reason?: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_update_customer: {
        Args: { _customer_id: string; _name: string }
        Returns: undefined
      }
      assert_admin_caller: { Args: never; Returns: string }
      assert_admin_remains: { Args: { _target: string }; Returns: undefined }
      assert_can_write_order: {
        Args: {
          _order: Database["public"]["Tables"]["orders"]["Row"]
          _uid: string
        }
        Returns: undefined
      }
      assert_permission: { Args: { _permission: string }; Returns: string }
      assert_row_version: {
        Args: { _current: number; _given: number }
        Returns: undefined
      }
      attach_graphic_revision: {
        Args: {
          _byte_size: number
          _checksum?: string
          _content_type: string
          _filename: string
          _idempotency_key?: string
          _order_id: string
          _storage_path: string
        }
        Returns: Json
      }
      caller_is_admin: { Args: never; Returns: boolean }
      can_read_directory: { Args: never; Returns: boolean }
      can_read_orders: { Args: never; Returns: boolean }
      cancel_order: {
        Args: {
          _idempotency_key?: string
          _order_id: string
          _reason: string
          _row_version: number
        }
        Returns: number
      }
      claim_invite: { Args: never; Returns: Json }
      command_begin:
        | {
            Args: { _command: string; _key: string }
            Returns: {
              is_new: boolean
              prior: string
            }[]
          }
        | {
            Args: { _command: string; _key: string; _payload: Json }
            Returns: {
              is_new: boolean
              prior: string
            }[]
          }
      command_finish: {
        Args: { _key: string; _result: string }
        Returns: undefined
      }
      create_order: {
        Args: {
          _critical_note?: string
          _customer_id: string
          _due_on: string
          _idempotency_key?: string
          _name: string
          _nominal_circumference_mm: number
          _note?: string
          _ordered_on?: string
          _priority?: Database["public"]["Enums"]["order_priority"]
          _quantity: number
          _supply_status?: Database["public"]["Enums"]["supply_status"]
          _target_length_mm: number
          _work_order_no: string
        }
        Returns: string
      }
      has_any_role: { Args: { _user_id: string }; Returns: boolean }
      has_permission: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_station_scope: {
        Args: { _station_id: string; _user_id: string }
        Returns: boolean
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      set_graphic_status: {
        Args: {
          _idempotency_key?: string
          _order_id: string
          _reason?: string
          _row_version: number
          _status: Database["public"]["Enums"]["graphic_status"]
        }
        Returns: number
      }
      update_order: {
        Args: {
          _critical_note?: string
          _due_on: string
          _idempotency_key?: string
          _name: string
          _nominal_circumference_mm: number
          _note?: string
          _order_id: string
          _priority: Database["public"]["Enums"]["order_priority"]
          _quantity: number
          _reason?: string
          _row_version: number
          _supply_status: Database["public"]["Enums"]["supply_status"]
          _target_length_mm: number
          _work_order_no: string
        }
        Returns: number
      }
      write_audit: {
        Args: {
          _action: string
          _entity_id: string
          _entity_type: string
          _new: Json
          _old: Json
          _reason: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "grafik"
        | "depo"
        | "operator"
        | "asistan"
        | "mudur"
        | "patron"
        | "muhasebe"
        | "admin"
      graphic_status:
        | "dosya_bekleniyor"
        | "renk_ayrimi"
        | "musteri_onayi"
        | "revize"
        | "grafik_hazir"
      order_closure_status: "acik" | "iptal"
      order_priority: "normal" | "yuksek" | "acil"
      supply_status:
        | "belirsiz"
        | "depoda_mevcut"
        | "silindir_bekleniyor"
        | "yeni_imalat"
        | "kismi"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "grafik",
        "depo",
        "operator",
        "asistan",
        "mudur",
        "patron",
        "muhasebe",
        "admin",
      ],
      graphic_status: [
        "dosya_bekleniyor",
        "renk_ayrimi",
        "musteri_onayi",
        "revize",
        "grafik_hazir",
      ],
      order_closure_status: ["acik", "iptal"],
      order_priority: ["normal", "yuksek", "acil"],
      supply_status: [
        "belirsiz",
        "depoda_mevcut",
        "silindir_bekleniyor",
        "yeni_imalat",
        "kismi",
      ],
    },
  },
} as const
