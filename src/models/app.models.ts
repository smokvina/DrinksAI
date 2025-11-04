export interface Place {
  name: string;
  rating?: string;
  reviews?: string;
  distance?: string;
  address?: string;
  hours?: string;
  quote?: string;
  price?: string;
  mapLink?: string;
}

export interface TextPart {
  type: 'text';
  content: string;
}

export interface UserImagePart {
  type: 'user-image';
  url: string; // data URL for preview
}

export interface LocationsPart {
  type: 'locations';
  title: string;
  places: Place[];
}

export interface ErrorPart {
  type: 'error';
  message: string;
}

export type ChatPart = TextPart | UserImagePart | LocationsPart | ErrorPart;

export interface ChatMessage {
  id: number;
  role: 'user' | 'model';
  parts: ChatPart[];
}