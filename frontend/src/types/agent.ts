export interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar_url: string | null;
  specializations: string[];
  preferred_model: string;
  collaboration_capable: boolean;
  collaboration_role: string | null;
  is_active: boolean;
}
