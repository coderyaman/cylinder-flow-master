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
      accounting_overrides: {
        Row: {
          billing: Database["public"]["Enums"]["billing_class"]
          created_at: string
          created_by: string | null
          id: string
          item_kind: string
          order_id: string
          reason: string
          ref_id: string
        }
        Insert: {
          billing: Database["public"]["Enums"]["billing_class"]
          created_at?: string
          created_by?: string | null
          id?: string
          item_kind: string
          order_id: string
          reason: string
          ref_id: string
        }
        Update: {
          billing?: Database["public"]["Enums"]["billing_class"]
          created_at?: string
          created_by?: string | null
          id?: string
          item_kind?: string
          order_id?: string
          reason?: string
          ref_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_overrides_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_packages: {
        Row: {
          created_at: string
          id: string
          last_fingerprint: string | null
          needs_review: boolean
          order_id: string
          processed_at: string | null
          processed_by: string | null
          review_reason: string | null
          shipment_id: string | null
          status: Database["public"]["Enums"]["accounting_status"]
          trigger: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_fingerprint?: string | null
          needs_review?: boolean
          order_id: string
          processed_at?: string | null
          processed_by?: string | null
          review_reason?: string | null
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["accounting_status"]
          trigger: string
        }
        Update: {
          created_at?: string
          id?: string
          last_fingerprint?: string | null
          needs_review?: boolean
          order_id?: string
          processed_at?: string | null
          processed_by?: string | null
          review_reason?: string | null
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["accounting_status"]
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_packages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_packages_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_processings: {
        Row: {
          fingerprint: string
          id: string
          item_count: number
          order_id: string
          package_id: string
          processed_at: string
          processed_by: string | null
          snapshot: Json
        }
        Insert: {
          fingerprint: string
          id?: string
          item_count: number
          order_id: string
          package_id: string
          processed_at?: string
          processed_by?: string | null
          snapshot: Json
        }
        Update: {
          fingerprint?: string
          id?: string
          item_count?: number
          order_id?: string
          package_id?: string
          processed_at?: string
          processed_by?: string | null
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "accounting_processings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_processings_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "accounting_packages"
            referencedColumns: ["id"]
          },
        ]
      }
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
      billing_rules: {
        Row: {
          default_billing: Database["public"]["Enums"]["billing_class"]
          label: string
          station_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          default_billing?: Database["public"]["Enums"]["billing_class"]
          label: string
          station_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          default_billing?: Database["public"]["Enums"]["billing_class"]
          label?: string
          station_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["cart_item_kind"]
          note: string | null
          planned_ops: Database["public"]["Enums"]["planned_op"][]
          receipt_id: string | null
          removed_at: string | null
          removed_by: string | null
          removed_reason: string | null
        }
        Insert: {
          cart_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["cart_item_kind"]
          note?: string | null
          planned_ops?: Database["public"]["Enums"]["planned_op"][]
          receipt_id?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
        }
        Update: {
          cart_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["cart_item_kind"]
          note?: string | null
          planned_ops?: Database["public"]["Enums"]["planned_op"][]
          receipt_id?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "order_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "cylinder_receipts"
            referencedColumns: ["id"]
          },
        ]
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
      cylinder_measurements: {
        Row: {
          circumference_mm: number
          diameter_mm: number
          id: string
          length_mm: number
          measured_at: string
          measured_by: string | null
          note: string | null
          receipt_id: string
          source: string
        }
        Insert: {
          circumference_mm: number
          diameter_mm: number
          id?: string
          length_mm: number
          measured_at?: string
          measured_by?: string | null
          note?: string | null
          receipt_id: string
          source?: string
        }
        Update: {
          circumference_mm?: number
          diameter_mm?: number
          id?: string
          length_mm?: number
          measured_at?: string
          measured_by?: string | null
          note?: string | null
          receipt_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "cylinder_measurements_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "cylinder_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      cylinder_receipts: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          cyl_code: string
          id: string
          label_print_count: number
          last_label_printed_at: string | null
          lifecycle: Database["public"]["Enums"]["cyl_lifecycle"]
          measured_circumference_mm: number
          measured_diameter_mm: number
          measured_length_mm: number
          measurements_recorded: boolean
          nominal_circumference_mm: number | null
          nominal_length_mm: number | null
          note: string | null
          origin: Database["public"]["Enums"]["cyl_origin"]
          received_on: string
          row_version: number
          shaft_type: Database["public"]["Enums"]["cyl_shaft_type"]
          status: Database["public"]["Enums"]["cyl_receipt_status"]
          surface_state: Database["public"]["Enums"]["cyl_surface_state"]
          updated_at: string
          updated_by: string | null
          usability: Database["public"]["Enums"]["cyl_usability"]
          visit_closed_at: string | null
          visit_closed_reason: string | null
          waybill_no: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          cyl_code: string
          id?: string
          label_print_count?: number
          last_label_printed_at?: string | null
          lifecycle?: Database["public"]["Enums"]["cyl_lifecycle"]
          measured_circumference_mm?: number
          measured_diameter_mm?: number
          measured_length_mm?: number
          measurements_recorded?: boolean
          nominal_circumference_mm?: number | null
          nominal_length_mm?: number | null
          note?: string | null
          origin?: Database["public"]["Enums"]["cyl_origin"]
          received_on?: string
          row_version?: number
          shaft_type: Database["public"]["Enums"]["cyl_shaft_type"]
          status?: Database["public"]["Enums"]["cyl_receipt_status"]
          surface_state: Database["public"]["Enums"]["cyl_surface_state"]
          updated_at?: string
          updated_by?: string | null
          usability: Database["public"]["Enums"]["cyl_usability"]
          visit_closed_at?: string | null
          visit_closed_reason?: string | null
          waybill_no?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          cyl_code?: string
          id?: string
          label_print_count?: number
          last_label_printed_at?: string | null
          lifecycle?: Database["public"]["Enums"]["cyl_lifecycle"]
          measured_circumference_mm?: number
          measured_diameter_mm?: number
          measured_length_mm?: number
          measurements_recorded?: boolean
          nominal_circumference_mm?: number | null
          nominal_length_mm?: number | null
          note?: string | null
          origin?: Database["public"]["Enums"]["cyl_origin"]
          received_on?: string
          row_version?: number
          shaft_type?: Database["public"]["Enums"]["cyl_shaft_type"]
          status?: Database["public"]["Enums"]["cyl_receipt_status"]
          surface_state?: Database["public"]["Enums"]["cyl_surface_state"]
          updated_at?: string
          updated_by?: string | null
          usability?: Database["public"]["Enums"]["cyl_usability"]
          visit_closed_at?: string | null
          visit_closed_reason?: string | null
          waybill_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cylinder_receipts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      cylinder_reservations: {
        Row: {
          cart_item_id: string
          created_at: string
          created_by: string | null
          id: string
          order_id: string
          receipt_id: string
          release_reason: string | null
          released_at: string | null
          released_by: string | null
          status: Database["public"]["Enums"]["reservation_status"]
        }
        Insert: {
          cart_item_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          order_id: string
          receipt_id: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
        }
        Update: {
          cart_item_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          order_id?: string
          receipt_id?: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "cylinder_reservations_cart_item_id_fkey"
            columns: ["cart_item_id"]
            isOneToOne: false
            referencedRelation: "cart_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cylinder_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cylinder_reservations_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "cylinder_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      defect_categories: {
        Row: {
          assessed_cause_only: boolean
          code: string
          created_at: string
          is_active: boolean
          label: string
          sort_order: number
        }
        Insert: {
          assessed_cause_only?: boolean
          code: string
          created_at?: string
          is_active?: boolean
          label: string
          sort_order?: number
        }
        Update: {
          assessed_cause_only?: boolean
          code?: string
          created_at?: string
          is_active?: boolean
          label?: string
          sort_order?: number
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
          cleanup_claimed_at: string | null
          consumed_at: string | null
          created_at: string
          expected_revision: number
          id: string
          order_id: string
          result_asset_id: string | null
          result_revision_no: number | null
          storage_path: string
          user_id: string
        }
        Insert: {
          cleaned_at?: string | null
          cleanup_claimed_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expected_revision: number
          id?: string
          order_id: string
          result_asset_id?: string | null
          result_revision_no?: number | null
          storage_path: string
          user_id: string
        }
        Update: {
          cleaned_at?: string | null
          cleanup_claimed_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expected_revision?: number
          id?: string
          order_id?: string
          result_asset_id?: string | null
          result_revision_no?: number | null
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
      operation_measurements: {
        Row: {
          circumference_mm: number | null
          coating_thickness_um: number | null
          diameter_mm: number | null
          id: string
          measured_at: string
          measured_by: string | null
          note: string | null
          operation_id: string
          receipt_id: string | null
          round_no: number
          station_code: string
          team_member_id: string
        }
        Insert: {
          circumference_mm?: number | null
          coating_thickness_um?: number | null
          diameter_mm?: number | null
          id?: string
          measured_at?: string
          measured_by?: string | null
          note?: string | null
          operation_id: string
          receipt_id?: string | null
          round_no?: number
          station_code: string
          team_member_id: string
        }
        Update: {
          circumference_mm?: number | null
          coating_thickness_um?: number | null
          diameter_mm?: number | null
          id?: string
          measured_at?: string
          measured_by?: string | null
          note?: string | null
          operation_id?: string
          receipt_id?: string | null
          round_no?: number
          station_code?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_measurements_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_measurements_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "cylinder_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_measurements_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_notes: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["op_note_kind"]
          operation_id: string | null
          receipt_id: string | null
          team_member_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["op_note_kind"]
          operation_id?: string | null
          receipt_id?: string | null
          team_member_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["op_note_kind"]
          operation_id?: string | null
          receipt_id?: string | null
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_notes_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_notes_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "cylinder_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_notes_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      operations: {
        Row: {
          bakir_works: Database["public"]["Enums"]["bakir_work"][]
          block_resolved_at: string | null
          block_resolved_by: string | null
          created_at: string
          finished_at: string | null
          finished_by: string | null
          graphic_asset_id: string | null
          id: string
          machine_held: boolean
          machine_id: string
          note: string | null
          op_label: string
          performed_works: Database["public"]["Enums"]["op_work"][]
          result: Database["public"]["Enums"]["op_result"] | null
          round_no: number
          route_step_id: string
          skip_queue_reason: string | null
          started_at: string
          started_by: string | null
          station_id: string
          status: Database["public"]["Enums"]["op_status"]
          team_member_id: string
        }
        Insert: {
          bakir_works?: Database["public"]["Enums"]["bakir_work"][]
          block_resolved_at?: string | null
          block_resolved_by?: string | null
          created_at?: string
          finished_at?: string | null
          finished_by?: string | null
          graphic_asset_id?: string | null
          id?: string
          machine_held?: boolean
          machine_id: string
          note?: string | null
          op_label: string
          performed_works?: Database["public"]["Enums"]["op_work"][]
          result?: Database["public"]["Enums"]["op_result"] | null
          round_no?: number
          route_step_id: string
          skip_queue_reason?: string | null
          started_at?: string
          started_by?: string | null
          station_id: string
          status?: Database["public"]["Enums"]["op_status"]
          team_member_id: string
        }
        Update: {
          bakir_works?: Database["public"]["Enums"]["bakir_work"][]
          block_resolved_at?: string | null
          block_resolved_by?: string | null
          created_at?: string
          finished_at?: string | null
          finished_by?: string | null
          graphic_asset_id?: string | null
          id?: string
          machine_held?: boolean
          machine_id?: string
          note?: string | null
          op_label?: string
          performed_works?: Database["public"]["Enums"]["op_work"][]
          result?: Database["public"]["Enums"]["op_result"] | null
          round_no?: number
          route_step_id?: string
          skip_queue_reason?: string | null
          started_at?: string
          started_by?: string | null
          station_id?: string
          status?: Database["public"]["Enums"]["op_status"]
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operations_graphic_asset_id_fkey"
            columns: ["graphic_asset_id"]
            isOneToOne: false
            referencedRelation: "graphic_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_route_step_id_fkey"
            columns: ["route_step_id"]
            isOneToOne: true
            referencedRelation: "route_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      order_carts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          order_id: string
          status: Database["public"]["Enums"]["cart_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          order_id: string
          status?: Database["public"]["Enums"]["cart_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          order_id?: string
          status?: Database["public"]["Enums"]["cart_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_carts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
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
          shipped_at: string | null
          shipped_by: string | null
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
          shipped_at?: string | null
          shipped_by?: string | null
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
          shipped_at?: string | null
          shipped_by?: string | null
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
      proof_run_members: {
        Row: {
          created_at: string
          flagged: boolean
          id: string
          quality_issue_id: string | null
          receipt_id: string | null
          run_id: string
          stage_no: number | null
          team_member_id: string
        }
        Insert: {
          created_at?: string
          flagged?: boolean
          id?: string
          quality_issue_id?: string | null
          receipt_id?: string | null
          run_id: string
          stage_no?: number | null
          team_member_id: string
        }
        Update: {
          created_at?: string
          flagged?: boolean
          id?: string
          quality_issue_id?: string | null
          receipt_id?: string | null
          run_id?: string
          stage_no?: number | null
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_run_members_quality_issue_id_fkey"
            columns: ["quality_issue_id"]
            isOneToOne: false
            referencedRelation: "quality_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_run_members_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "cylinder_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_run_members_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "proof_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_run_members_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_runs: {
        Row: {
          category_code: string | null
          created_at: string
          finished_at: string | null
          finished_by: string | null
          id: string
          machine_id: string
          membership_fingerprint: string
          note: string | null
          result: Database["public"]["Enums"]["proof_result"] | null
          round_no: number
          started_at: string
          started_by: string | null
          status: Database["public"]["Enums"]["proof_status"]
          team_id: string
        }
        Insert: {
          category_code?: string | null
          created_at?: string
          finished_at?: string | null
          finished_by?: string | null
          id?: string
          machine_id: string
          membership_fingerprint: string
          note?: string | null
          result?: Database["public"]["Enums"]["proof_result"] | null
          round_no: number
          started_at?: string
          started_by?: string | null
          status?: Database["public"]["Enums"]["proof_status"]
          team_id: string
        }
        Update: {
          category_code?: string | null
          created_at?: string
          finished_at?: string | null
          finished_by?: string | null
          id?: string
          machine_id?: string
          membership_fingerprint?: string
          note?: string | null
          result?: Database["public"]["Enums"]["proof_result"] | null
          round_no?: number
          started_at?: string
          started_by?: string | null
          status?: Database["public"]["Enums"]["proof_status"]
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_runs_category_code_fkey"
            columns: ["category_code"]
            isOneToOne: false
            referencedRelation: "defect_categories"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "proof_runs_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_runs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_issues: {
        Row: {
          billable: boolean | null
          category_code: string
          cylinder_removed: boolean
          decided_at: string | null
          decided_by: string | null
          decision: Database["public"]["Enums"]["quality_decision"] | null
          decision_reason: string | null
          description: string
          detected_station_id: string
          id: string
          master_consult_note: string | null
          note_id: string | null
          operation_id: string | null
          proof_run_id: string | null
          proposed_action: Database["public"]["Enums"]["quality_action"]
          receipt_id: string | null
          requested_at: string
          requested_by: string | null
          resolved_at: string | null
          responsibility: Database["public"]["Enums"]["quality_responsibility"]
          root_cause_code: string | null
          severity: Database["public"]["Enums"]["op_note_kind"]
          status: Database["public"]["Enums"]["quality_status"]
          team_member_id: string
        }
        Insert: {
          billable?: boolean | null
          category_code: string
          cylinder_removed?: boolean
          decided_at?: string | null
          decided_by?: string | null
          decision?: Database["public"]["Enums"]["quality_decision"] | null
          decision_reason?: string | null
          description: string
          detected_station_id: string
          id?: string
          master_consult_note?: string | null
          note_id?: string | null
          operation_id?: string | null
          proof_run_id?: string | null
          proposed_action?: Database["public"]["Enums"]["quality_action"]
          receipt_id?: string | null
          requested_at?: string
          requested_by?: string | null
          resolved_at?: string | null
          responsibility?: Database["public"]["Enums"]["quality_responsibility"]
          root_cause_code?: string | null
          severity?: Database["public"]["Enums"]["op_note_kind"]
          status?: Database["public"]["Enums"]["quality_status"]
          team_member_id: string
        }
        Update: {
          billable?: boolean | null
          category_code?: string
          cylinder_removed?: boolean
          decided_at?: string | null
          decided_by?: string | null
          decision?: Database["public"]["Enums"]["quality_decision"] | null
          decision_reason?: string | null
          description?: string
          detected_station_id?: string
          id?: string
          master_consult_note?: string | null
          note_id?: string | null
          operation_id?: string | null
          proof_run_id?: string | null
          proposed_action?: Database["public"]["Enums"]["quality_action"]
          receipt_id?: string | null
          requested_at?: string
          requested_by?: string | null
          resolved_at?: string | null
          responsibility?: Database["public"]["Enums"]["quality_responsibility"]
          root_cause_code?: string | null
          severity?: Database["public"]["Enums"]["op_note_kind"]
          status?: Database["public"]["Enums"]["quality_status"]
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_issues_category_code_fkey"
            columns: ["category_code"]
            isOneToOne: false
            referencedRelation: "defect_categories"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "quality_issues_detected_station_id_fkey"
            columns: ["detected_station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_issues_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "operation_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_issues_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_issues_proof_run_id_fkey"
            columns: ["proof_run_id"]
            isOneToOne: false
            referencedRelation: "proof_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_issues_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "cylinder_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_issues_root_cause_code_fkey"
            columns: ["root_cause_code"]
            isOneToOne: false
            referencedRelation: "defect_categories"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "quality_issues_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
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
      route_plans: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          quality_issue_id: string | null
          reason: string | null
          rework_round: number | null
          status: Database["public"]["Enums"]["route_plan_status"]
          team_member_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          quality_issue_id?: string | null
          reason?: string | null
          rework_round?: number | null
          status?: Database["public"]["Enums"]["route_plan_status"]
          team_member_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          quality_issue_id?: string | null
          reason?: string | null
          rework_round?: number | null
          status?: Database["public"]["Enums"]["route_plan_status"]
          team_member_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "route_plans_quality_issue_id_fkey"
            columns: ["quality_issue_id"]
            isOneToOne: false
            referencedRelation: "quality_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_plans_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      route_steps: {
        Row: {
          created_at: string
          id: string
          op_label: string
          plan_id: string
          queue_rank: number | null
          queued_at: string | null
          round_no: number
          seq: number
          skip_reason: string | null
          skipped: boolean
          station_id: string
          status: Database["public"]["Enums"]["route_step_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          op_label: string
          plan_id: string
          queue_rank?: number | null
          queued_at?: string | null
          round_no?: number
          seq: number
          skip_reason?: string | null
          skipped?: boolean
          station_id: string
          status?: Database["public"]["Enums"]["route_step_status"]
        }
        Update: {
          created_at?: string
          id?: string
          op_label?: string
          plan_id?: string
          queue_rank?: number | null
          queued_at?: string | null
          round_no?: number
          seq?: number
          skip_reason?: string | null
          skipped?: boolean
          station_id?: string
          status?: Database["public"]["Enums"]["route_step_status"]
        }
        Relationships: [
          {
            foreignKeyName: "route_steps_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "route_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_steps_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_items: {
        Row: {
          circumference_mm: number | null
          created_at: string
          cyl_code: string | null
          diameter_mm: number | null
          id: string
          length_mm: number | null
          receipt_id: string | null
          shipment_id: string
          stage_no: number | null
          team_member_id: string
        }
        Insert: {
          circumference_mm?: number | null
          created_at?: string
          cyl_code?: string | null
          diameter_mm?: number | null
          id?: string
          length_mm?: number | null
          receipt_id?: string | null
          shipment_id: string
          stage_no?: number | null
          team_member_id: string
        }
        Update: {
          circumference_mm?: number | null
          created_at?: string
          cyl_code?: string | null
          diameter_mm?: number | null
          id?: string
          length_mm?: number | null
          receipt_id?: string | null
          shipment_id?: string
          stage_no?: number | null
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "cylinder_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          created_at: string
          id: string
          member_count: number
          membership_fingerprint: string
          note: string | null
          order_id: string
          proof_run_id: string | null
          shipped_at: string
          shipped_by: string | null
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_count: number
          membership_fingerprint: string
          note?: string | null
          order_id: string
          proof_run_id?: string | null
          shipped_at?: string
          shipped_by?: string | null
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_count?: number
          membership_fingerprint?: string
          note?: string | null
          order_id?: string
          proof_run_id?: string | null
          shipped_at?: string
          shipped_by?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_proof_run_id_fkey"
            columns: ["proof_run_id"]
            isOneToOne: false
            referencedRelation: "proof_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
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
      team_members: {
        Row: {
          added_at: string
          added_by: string | null
          cart_item_id: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["cart_item_kind"]
          planned_ops: Database["public"]["Enums"]["planned_op"][]
          proof_ready_at: string | null
          receipt_id: string | null
          released_at: string | null
          released_by: string | null
          removed_at: string | null
          removed_by: string | null
          removed_reason: string | null
          replaced_by_member_id: string | null
          replaces_member_id: string | null
          sequence_no: number
          stage_no: number | null
          team_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          cart_item_id: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["cart_item_kind"]
          planned_ops?: Database["public"]["Enums"]["planned_op"][]
          proof_ready_at?: string | null
          receipt_id?: string | null
          released_at?: string | null
          released_by?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          replaced_by_member_id?: string | null
          replaces_member_id?: string | null
          sequence_no: number
          stage_no?: number | null
          team_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          cart_item_id?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["cart_item_kind"]
          planned_ops?: Database["public"]["Enums"]["planned_op"][]
          proof_ready_at?: string | null
          receipt_id?: string | null
          released_at?: string | null
          released_by?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          replaced_by_member_id?: string | null
          replaces_member_id?: string | null
          sequence_no?: number
          stage_no?: number | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_cart_item_id_fkey"
            columns: ["cart_item_id"]
            isOneToOne: false
            referencedRelation: "cart_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "cylinder_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_replaced_by_member_id_fkey"
            columns: ["replaced_by_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_replaces_member_id_fkey"
            columns: ["replaces_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          approved_run_id: string | null
          blocked_at: string | null
          blocked_reason: string | null
          created_at: string
          created_by: string | null
          id: string
          order_id: string
          proof_queued_at: string | null
          shipment_ready_at: string | null
          shipment_ready_fingerprint: string | null
          team_code: string
        }
        Insert: {
          approved_run_id?: string | null
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          order_id: string
          proof_queued_at?: string | null
          shipment_ready_at?: string | null
          shipment_ready_fingerprint?: string | null
          team_code: string
        }
        Update: {
          approved_run_id?: string | null
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          order_id?: string
          proof_queued_at?: string | null
          shipment_ready_at?: string | null
          shipment_ready_fingerprint?: string | null
          team_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_approved_run_id_fkey"
            columns: ["approved_run_id"]
            isOneToOne: false
            referencedRelation: "proof_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
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
      accounting_items: { Args: { _order_id: string }; Returns: Json }
      accounting_process: {
        Args: { _idempotency_key?: string; _note?: string; _order_id: string }
        Returns: string
      }
      accounting_set_billing: {
        Args: {
          _billing: Database["public"]["Enums"]["billing_class"]
          _idempotency_key?: string
          _item_kind: string
          _order_id: string
          _reason: string
          _ref_id: string
        }
        Returns: string
      }
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
      assert_station_allowed: {
        Args: { _station_id: string; _uid: string }
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
      can_read_inventory: { Args: never; Returns: boolean }
      can_read_orders: { Args: never; Returns: boolean }
      cancel_cylinder_receipt: {
        Args: {
          _idempotency_key?: string
          _reason: string
          _receipt_id: string
          _row_version: number
        }
        Returns: number
      }
      cancel_order: {
        Args: {
          _idempotency_key?: string
          _order_id: string
          _reason: string
          _row_version: number
        }
        Returns: number
      }
      cart_add_existing: {
        Args: {
          _idempotency_key?: string
          _order_id: string
          _planned_ops?: Database["public"]["Enums"]["planned_op"][]
          _receipt_id: string
        }
        Returns: string
      }
      cart_add_planned: {
        Args: {
          _idempotency_key?: string
          _note?: string
          _order_id: string
          _planned_ops?: Database["public"]["Enums"]["planned_op"][]
        }
        Returns: string
      }
      cart_ensure: {
        Args: { _order_id: string; _uid: string }
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          order_id: string
          status: Database["public"]["Enums"]["cart_status"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_carts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cart_remove_item: {
        Args: { _item_id: string; _reason?: string }
        Returns: undefined
      }
      cart_set_item_ops: {
        Args: {
          _item_id: string
          _planned_ops: Database["public"]["Enums"]["planned_op"][]
        }
        Returns: undefined
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
      create_team: {
        Args: { _idempotency_key?: string; _order_id: string }
        Returns: Json
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
      kanban_board: { Args: never; Returns: Json }
      kanban_order_detail: { Args: { _order_id: string }; Returns: Json }
      op_ack_note: { Args: { _note_id: string }; Returns: undefined }
      op_add_note: {
        Args: {
          _body: string
          _kind: Database["public"]["Enums"]["op_note_kind"]
          _operation_id: string
        }
        Returns: string
      }
      op_close_common: {
        Args: {
          _auto_queue: boolean
          _note: string
          _op_id: string
          _result: Database["public"]["Enums"]["op_result"]
          _uid: string
        }
        Returns: Json
      }
      op_complete_bakir: {
        Args: {
          _circumference_mm?: number
          _coating_thickness_um?: number
          _diameter_mm?: number
          _idempotency_key?: string
          _note?: string
          _operation_id: string
          _result: Database["public"]["Enums"]["op_result"]
          _works: Database["public"]["Enums"]["bakir_work"][]
        }
        Returns: Json
      }
      op_complete_krom: {
        Args: {
          _idempotency_key?: string
          _note?: string
          _operation_id: string
          _result: Database["public"]["Enums"]["op_result"]
        }
        Returns: Json
      }
      op_complete_simple: {
        Args: {
          _idempotency_key?: string
          _note?: string
          _operation_id: string
          _result: Database["public"]["Enums"]["op_result"]
          _station_code: string
        }
        Returns: Json
      }
      op_complete_sokme: {
        Args: {
          _idempotency_key?: string
          _note?: string
          _operation_id: string
          _result: Database["public"]["Enums"]["op_result"]
        }
        Returns: Json
      }
      op_complete_taslama: {
        Args: {
          _circumference_mm?: number
          _diameter_mm?: number
          _idempotency_key?: string
          _note?: string
          _operation_id: string
          _result: Database["public"]["Enums"]["op_result"]
          _stage_no?: number
        }
        Returns: Json
      }
      op_complete_torna: {
        Args: {
          _idempotency_key?: string
          _note?: string
          _operation_id: string
          _result: Database["public"]["Enums"]["op_result"]
          _works: Database["public"]["Enums"]["op_work"][]
        }
        Returns: Json
      }
      op_open_for_complete: {
        Args: { _op_id: string; _station_code: string; _uid: string }
        Returns: {
          bakir_works: Database["public"]["Enums"]["bakir_work"][]
          block_resolved_at: string | null
          block_resolved_by: string | null
          created_at: string
          finished_at: string | null
          finished_by: string | null
          graphic_asset_id: string | null
          id: string
          machine_held: boolean
          machine_id: string
          note: string | null
          op_label: string
          performed_works: Database["public"]["Enums"]["op_work"][]
          result: Database["public"]["Enums"]["op_result"] | null
          round_no: number
          route_step_id: string
          skip_queue_reason: string | null
          started_at: string
          started_by: string | null
          station_id: string
          status: Database["public"]["Enums"]["op_status"]
          team_member_id: string
        }
        SetofOptions: {
          from: "*"
          to: "operations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      op_record_measurement: {
        Args: {
          _circ: number
          _coating: number
          _diam: number
          _note: string
          _op: Database["public"]["Tables"]["operations"]["Row"]
          _station_code: string
          _uid: string
        }
        Returns: undefined
      }
      op_start: {
        Args: {
          _idempotency_key?: string
          _machine_id: string
          _qr_code?: string
          _skip_queue_reason?: string
          _step_id: string
        }
        Returns: Json
      }
      proof_complete: {
        Args: {
          _category_code?: string
          _idempotency_key?: string
          _member_ids?: string[]
          _note?: string
          _result: Database["public"]["Enums"]["proof_result"]
          _run_id: string
        }
        Returns: Json
      }
      proof_gate: { Args: { _team_id: string }; Returns: Json }
      proof_release_hold: {
        Args: { _idempotency_key?: string; _reason: string; _team_id: string }
        Returns: Json
      }
      proof_start: {
        Args: {
          _idempotency_key?: string
          _machine_id: string
          _qr_code?: string
          _team_id: string
        }
        Returns: Json
      }
      quality_decide: {
        Args: {
          _decision: Database["public"]["Enums"]["quality_decision"]
          _idempotency_key?: string
          _issue_id: string
          _reason: string
          _responsibility?: Database["public"]["Enums"]["quality_responsibility"]
          _root_cause_code?: string
        }
        Returns: Json
      }
      quality_release_machine: {
        Args: { _issue_id: string }
        Returns: undefined
      }
      quality_report: {
        Args: {
          _category_code: string
          _cylinder_removed?: boolean
          _description: string
          _idempotency_key?: string
          _master_consult_note?: string
          _operation_id: string
          _proposed_action?: Database["public"]["Enums"]["quality_action"]
          _severity: Database["public"]["Enums"]["op_note_kind"]
        }
        Returns: Json
      }
      quality_resume_flow: {
        Args: { _idempotency_key?: string; _issue_id: string }
        Returns: Json
      }
      queue_reorder: {
        Args: { _station_id: string; _step_ids: string[] }
        Returns: number
      }
      receive_cylinder: {
        Args: {
          _customer_id: string
          _idempotency_key?: string
          _measured_circumference_mm: number
          _measured_diameter_mm: number
          _measured_length_mm: number
          _note?: string
          _received_on?: string
          _shaft_type: Database["public"]["Enums"]["cyl_shaft_type"]
          _surface_state: Database["public"]["Enums"]["cyl_surface_state"]
          _usability: Database["public"]["Enums"]["cyl_usability"]
          _waybill_no?: string
        }
        Returns: Json
      }
      record_label_print: { Args: { _receipt_id: string }; Returns: number }
      release_to_production: {
        Args: { _idempotency_key?: string; _member_ids: string[] }
        Returns: Json
      }
      rework_approve: {
        Args: {
          _idempotency_key?: string
          _issue_id: string
          _reason?: string
          _steps: Json
        }
        Returns: Json
      }
      rework_suggest: { Args: { _issue_id: string }; Returns: Json }
      route_save_plan: {
        Args: {
          _idempotency_key?: string
          _member_id: string
          _reason?: string
          _steps: Json
        }
        Returns: string
      }
      route_suggest: { Args: { _member_id: string }; Returns: Json }
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
      ship_team: {
        Args: { _idempotency_key?: string; _note?: string; _team_id: string }
        Returns: Json
      }
      shipment_gate: { Args: { _team_id: string }; Returns: Json }
      srv_attach_graphic_revision: {
        Args: {
          _actor: string
          _byte_size: number
          _checksum?: string
          _filename: string
          _session_id: string
        }
        Returns: Json
      }
      srv_graphic_access_grant: {
        Args: { _actor: string; _asset_id: string }
        Returns: Json
      }
      srv_graphic_claim_orphans: {
        Args: { _older_minutes?: number }
        Returns: {
          session_id: string
          storage_path: string
        }[]
      }
      srv_graphic_mark_cleaned: {
        Args: { _session_ids: string[] }
        Returns: number
      }
      srv_graphic_orphan_sessions: {
        Args: { _older_minutes?: number }
        Returns: {
          session_id: string
          storage_path: string
        }[]
      }
      srv_graphic_upload_target: {
        Args: { _actor: string; _expected_revision: number; _order_id: string }
        Returns: Json
      }
      srv_operation_graphic: {
        Args: { _actor: string; _operation_id: string }
        Returns: Json
      }
      srv_team_graphic: {
        Args: { _actor: string; _team_id: string }
        Returns: Json
      }
      team_proof_fingerprint: { Args: { _team_id: string }; Returns: string }
      team_replace_member: {
        Args: {
          _idempotency_key?: string
          _issue_id?: string
          _member_id: string
          _old_lifecycle?: Database["public"]["Enums"]["cyl_lifecycle"]
          _planned_ops?: Database["public"]["Enums"]["planned_op"][]
          _reason: string
          _replacement_receipt_id?: string
        }
        Returns: Json
      }
      team_sync_new_items: { Args: { _order_id: string }; Returns: number }
      update_cylinder_receipt: {
        Args: {
          _idempotency_key?: string
          _measured_circumference_mm: number
          _measured_diameter_mm: number
          _measured_length_mm: number
          _note?: string
          _reason?: string
          _receipt_id: string
          _row_version: number
          _shaft_type: Database["public"]["Enums"]["cyl_shaft_type"]
          _surface_state: Database["public"]["Enums"]["cyl_surface_state"]
          _usability: Database["public"]["Enums"]["cyl_usability"]
          _waybill_no?: string
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
      accounting_status: "bekliyor" | "islendi"
      app_role:
        | "grafik"
        | "depo"
        | "operator"
        | "asistan"
        | "mudur"
        | "patron"
        | "muhasebe"
        | "admin"
      bakir_work:
        | "bakir_kaplama"
        | "ana_kaplama"
        | "cevre_yukseltme"
        | "cevre_dusurme"
        | "nokta_tamiri"
      billing_class:
        | "faturalandirilabilir"
        | "faturalandirilmayacak"
        | "karar_bekliyor"
      cart_item_kind: "mevcut" | "yeni_imalat"
      cart_status: "taslak" | "takim_olusturuldu"
      cyl_lifecycle:
        | "depoda"
        | "kontrol_bekliyor"
        | "tamir_bekliyor"
        | "uretimde"
        | "sevk_edildi"
        | "hurda"
      cyl_origin: "kabul" | "yeni_imalat"
      cyl_receipt_status: "kabul" | "iptal"
      cyl_shaft_type: "konik" | "silindirik" | "flansli" | "diger"
      cyl_surface_state: "temiz" | "bakirli" | "kromlu" | "asinmis" | "hasarli"
      cyl_usability: "kullanilabilir" | "sartli" | "kullanilamaz"
      graphic_status:
        | "dosya_bekleniyor"
        | "renk_ayrimi"
        | "musteri_onayi"
        | "revize"
        | "grafik_hazir"
      op_note_kind: "not" | "uyari" | "bloke"
      op_result: "basarili" | "sorunlu"
      op_status: "devam" | "tamamlandi" | "bloke"
      op_work:
        | "yeni_imalat"
        | "cevre_dusurme"
        | "cevre_yukseltme"
        | "mil_cakma"
        | "yuzuk_degisimi"
        | "tamir"
      order_closure_status: "acik" | "iptal"
      order_priority: "normal" | "yuksek" | "acil"
      planned_op:
        | "cevre_dusurme"
        | "cevre_yukseltme"
        | "ana_kaplama"
        | "mil_cakma"
        | "yuzuk_degisimi"
        | "tamir"
      proof_result:
        | "onaylandi"
        | "tekrar_prova"
        | "silindir_duzeltilecek"
        | "takim_yeniden"
      proof_status: "devam" | "tamamlandi"
      quality_action:
        | "yeniden_kontrol"
        | "tekrar_islem"
        | "silindir_degisimi"
        | "bilinmiyor"
      quality_decision:
        | "devam"
        | "rework"
        | "silindir_degisimi"
        | "red"
        | "ek_bilgi"
      quality_responsibility: "ic_hata" | "musteri_revizyonu" | "bilinmiyor"
      quality_status:
        | "acik"
        | "bilgi_bekleniyor"
        | "karar_verildi"
        | "reddedildi"
      reservation_status: "aktif" | "birakildi"
      route_plan_status: "taslak" | "yururlukte" | "superseded"
      route_step_status:
        | "planlandi"
        | "kuyrukta"
        | "atlandi"
        | "superseded"
        | "tamamlandi"
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
      accounting_status: ["bekliyor", "islendi"],
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
      bakir_work: [
        "bakir_kaplama",
        "ana_kaplama",
        "cevre_yukseltme",
        "cevre_dusurme",
        "nokta_tamiri",
      ],
      billing_class: [
        "faturalandirilabilir",
        "faturalandirilmayacak",
        "karar_bekliyor",
      ],
      cart_item_kind: ["mevcut", "yeni_imalat"],
      cart_status: ["taslak", "takim_olusturuldu"],
      cyl_lifecycle: [
        "depoda",
        "kontrol_bekliyor",
        "tamir_bekliyor",
        "uretimde",
        "sevk_edildi",
        "hurda",
      ],
      cyl_origin: ["kabul", "yeni_imalat"],
      cyl_receipt_status: ["kabul", "iptal"],
      cyl_shaft_type: ["konik", "silindirik", "flansli", "diger"],
      cyl_surface_state: ["temiz", "bakirli", "kromlu", "asinmis", "hasarli"],
      cyl_usability: ["kullanilabilir", "sartli", "kullanilamaz"],
      graphic_status: [
        "dosya_bekleniyor",
        "renk_ayrimi",
        "musteri_onayi",
        "revize",
        "grafik_hazir",
      ],
      op_note_kind: ["not", "uyari", "bloke"],
      op_result: ["basarili", "sorunlu"],
      op_status: ["devam", "tamamlandi", "bloke"],
      op_work: [
        "yeni_imalat",
        "cevre_dusurme",
        "cevre_yukseltme",
        "mil_cakma",
        "yuzuk_degisimi",
        "tamir",
      ],
      order_closure_status: ["acik", "iptal"],
      order_priority: ["normal", "yuksek", "acil"],
      planned_op: [
        "cevre_dusurme",
        "cevre_yukseltme",
        "ana_kaplama",
        "mil_cakma",
        "yuzuk_degisimi",
        "tamir",
      ],
      proof_result: [
        "onaylandi",
        "tekrar_prova",
        "silindir_duzeltilecek",
        "takim_yeniden",
      ],
      proof_status: ["devam", "tamamlandi"],
      quality_action: [
        "yeniden_kontrol",
        "tekrar_islem",
        "silindir_degisimi",
        "bilinmiyor",
      ],
      quality_decision: [
        "devam",
        "rework",
        "silindir_degisimi",
        "red",
        "ek_bilgi",
      ],
      quality_responsibility: ["ic_hata", "musteri_revizyonu", "bilinmiyor"],
      quality_status: [
        "acik",
        "bilgi_bekleniyor",
        "karar_verildi",
        "reddedildi",
      ],
      reservation_status: ["aktif", "birakildi"],
      route_plan_status: ["taslak", "yururlukte", "superseded"],
      route_step_status: [
        "planlandi",
        "kuyrukta",
        "atlandi",
        "superseded",
        "tamamlandi",
      ],
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
