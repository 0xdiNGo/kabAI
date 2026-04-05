export interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  tags: string[];
  avatar_url: string | null;
  specializations: string[];
  preferred_model: string | null;
  knowledge_base_ids: string[];
  exemplar_set_ids: string[];
  search_provider_ids: string[];
  collaboration_capable: boolean;
  collaboration_role: string | null;
  is_active: boolean;
}
