insert into storage.buckets (
  id,
  name,
  public,
  allowed_mime_types,
  file_size_limit
)
values (
  'course-videos',
  'course-videos',
  false,
  array['video/mp4']::text[],
  52428800
)
on conflict (id) do update
set
  public = false,
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;
