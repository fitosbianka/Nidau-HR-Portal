export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type DocumentCategory = 'vertrag' | 'lohn' | 'zeiterfassung' | 'arztzeugnis' | 'allgemein'

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string
          email: string
          role: 'admin' | 'employee'
          job_title: string | null
          is_active: boolean
          last_login: string | null
          created_at: string
          // Personal details
          birthday: string | null
          address: string | null
          phone: string | null
          // Accounting details
          ahv_nummer: string | null
          children_count: number | null
          marital_status: string | null
          // HR details
          pensum: number | null
          eintrittsdatum: string | null
          bruttolohn_100: number | null
          monatslohn: number | null
          // Schedule
          abbreviation: string | null
          schedule_order: number | null
          show_in_schedule: boolean | null
        }
        Insert: {
          id: string
          full_name: string
          email: string
          role?: 'admin' | 'employee'
          job_title?: string | null
          is_active?: boolean
          last_login?: string | null
          created_at?: string
          birthday?: string | null
          address?: string | null
          phone?: string | null
          ahv_nummer?: string | null
          children_count?: number | null
          marital_status?: string | null
          pensum?: number | null
          eintrittsdatum?: string | null
          bruttolohn_100?: number | null
          monatslohn?: number | null
          abbreviation?: string | null
          schedule_order?: number | null
          show_in_schedule?: boolean | null
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          role?: 'admin' | 'employee'
          job_title?: string | null
          is_active?: boolean
          last_login?: string | null
          created_at?: string
          birthday?: string | null
          address?: string | null
          phone?: string | null
          ahv_nummer?: string | null
          children_count?: number | null
          marital_status?: string | null
          pensum?: number | null
          eintrittsdatum?: string | null
          bruttolohn_100?: number | null
          monatslohn?: number | null
          abbreviation?: string | null
          schedule_order?: number | null
          show_in_schedule?: boolean | null
        }
      }
      salary_history: {
        Row: {
          id: string
          employee_id: string
          effective_date: string
          pensum: number | null
          monatslohn: number | null
          bruttolohn_100: number | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          effective_date: string
          pensum?: number | null
          monatslohn?: number | null
          bruttolohn_100?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          effective_date?: string
          pensum?: number | null
          monatslohn?: number | null
          bruttolohn_100?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
      documents: {
        Row: {
          id: string
          employee_id: string | null
          file_name: string
          label: string
          file_path: string
          file_type: string
          category: DocumentCategory
          uploaded_by: string
          viewed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          employee_id?: string | null
          file_name: string
          label: string
          file_path: string
          file_type: string
          category?: DocumentCategory
          uploaded_by: string
          viewed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          employee_id?: string | null
          file_name?: string
          label?: string
          file_path?: string
          file_type?: string
          category?: DocumentCategory
          uploaded_by?: string
          viewed_at?: string | null
          created_at?: string
        }
      }
    }
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type Document = Database['public']['Tables']['documents']['Row']
export type SalaryHistory = Database['public']['Tables']['salary_history']['Row']
