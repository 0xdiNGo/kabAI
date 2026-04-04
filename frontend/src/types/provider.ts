export interface Provider {
  id: string;
  name: string;
  display_name: string;
  provider_type: string;
  api_base: string | null;
  has_api_key: boolean;
  is_enabled: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  provider_display_name: string;
}
