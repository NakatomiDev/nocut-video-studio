# =============================================================================
# NoCut — GCP / Vertex AI Configuration (Phase 2)
# =============================================================================
# This file configures GCP resources for Phase 2 AI fill generation.
# Phase 1 MVP uses crossfade-based fills and does not require GCP.
#
# Prerequisites:
#   1. Create GCP project:  gcloud projects create nocut-ai-dev
#   2. Enable billing:      https://console.cloud.google.com/billing
#   3. Enable APIs:         gcloud services enable aiplatform.googleapis.com storage.googleapis.com
#   4. Create SA key:       See infra/scripts/verify-gcp.sh
# =============================================================================

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project     = var.gcp_project_id
  region      = var.gcp_region
  credentials = var.gcp_credentials_file != "" ? file(var.gcp_credentials_file) : null
}

# ── Variables ──

variable "gcp_project_id" {
  description = "GCP project ID for Vertex AI"
  type        = string
  default     = "nocut-ai-dev"
}

variable "gcp_region" {
  description = "GCP region for Vertex AI resources"
  type        = string
  default     = "us-central1"
}

variable "gcp_credentials_file" {
  description = "Path to GCP service account key JSON file"
  type        = string
  default     = ""
}

# ── Vertex AI Endpoint (placeholder for Phase 2) ──
# Uncomment when ready to deploy an AI model for fill generation.
#
# resource "google_vertex_ai_endpoint" "fill_generator" {
#   display_name = "nocut-fill-generator-${var.environment}"
#   location     = var.gcp_region
#   description  = "NoCut AI fill generation endpoint"
#
#   labels = {
#     project     = "nocut"
#     environment = var.environment
#     managed_by  = "terraform"
#   }
# }

# ── Outputs ──

output "gcp_project_id" {
  description = "GCP project ID"
  value       = var.gcp_project_id
}

output "gcp_region" {
  description = "GCP region for Vertex AI"
  value       = var.gcp_region
}
