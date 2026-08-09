import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FILE_BUCKET = "product-files";
/** 링크가 새더라도 오래 살아 있지 않게 짧게 끊는다. */
const SIGNED_URL_TTL_SECONDS = 60;

type ProductFileRow = {
  file_path: string;
  file_name: string | null;
  file_content_type: string | null;
};

/**
 * 자료 내려받기.
 *
 * 파일 주소를 화면에 심지 않고 매 요청마다 이용권을 확인한 뒤 짧게 사는 서명
 * 주소를 발급한다. 무료 자료의 목적은 회원 확보라, 주소 하나가 공유되면 그
 * 목적이 통째로 무너진다.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!isProductSlug(slug)) {
    return json({ error: "자료를 찾지 못했습니다." }, 404);
  }

  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);
  if (!identity) return json({ error: "로그인이 필요합니다." }, 401);

  const { data, error } = await supabase.rpc("get_my_product_file", {
    target_product_slug: slug,
  });

  if (error) {
    console.error("Failed to load product file:", error.message);
    return json({ error: "자료를 준비하지 못했습니다." }, 503);
  }

  const row = (Array.isArray(data) ? data[0] : data) as ProductFileRow | undefined;
  // 이용권이 없어도 자료가 없어도 같은 응답을 준다. 어느 쪽인지 알려주면
  // 남의 이용권 보유 여부를 떠볼 수 있다.
  if (!row?.file_path) {
    return json({ error: "내려받을 수 있는 자료가 없습니다." }, 404);
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(FILE_BUCKET)
    .createSignedUrl(row.file_path, SIGNED_URL_TTL_SECONDS, {
      download: row.file_name ?? true,
    });

  if (signError || !signed?.signedUrl) {
    if (signError) console.error("Failed to sign product file:", signError.message);
    return json({ error: "자료를 준비하지 못했습니다." }, 503);
  }

  return Response.redirect(signed.signedUrl, 302);
}

function isProductSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100;
}

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
