export interface NewsCardItem {
  id?: string
  img: string
  title: string
  desc: string
  accentColor: string
  date?: string
  author?: string
  content?: string
  type?: string
  youtubeVideoId?: string | null
  youtubeUrl?: string | null
  videoUrl?: string | null
  videoMimeType?: string | null
}
