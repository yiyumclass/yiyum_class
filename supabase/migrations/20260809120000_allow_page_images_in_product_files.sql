-- 자료 버킷에 문서 형식만 열어 두었더니 페이지 미리보기 이미지가 거부됐다.
-- 페이지 이미지는 같은 버킷에 들어가고 storage 정책이 문서와 갈라 준다.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/webp'
]::text[]
where id = 'product-files';
