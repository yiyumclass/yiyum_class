import Image from "next/image";
import LandingInteractions from "@/components/LandingInteractions";
import ReviewMarquee from "@/components/ReviewMarquee";
import SiteFooter from "@/components/layout/SiteFooter";
import SiteHeader from "@/components/layout/SiteHeader";
import CourseEnrollmentPicker, {
  CourseEnrollmentProvider,
} from "@/components/store/CourseEnrollmentPicker";
import {
  membershipEconomicOutcomeNotice,
  membershipPlanDefinitions,
  phonePassDefinition,
} from "@/lib/store/membership-plans";
import { loadPublicCourseCatalog } from "@/lib/store/public-course-catalog";
import { loadPublicProductBySlug } from "@/lib/store/public-products";

// 상품 가격과 판매 상태는 어드민에서 바뀌므로 홈을 요청할 때 최신 DB 값을 읽는다.
export const dynamic = "force-dynamic";

const featuredCourseSlug = "sns-monetization";
const landingCourseDescription =
  "계정 세팅부터 콘텐츠, 알고리즘, 브랜드 협업 준비와 브랜딩까지 계정을 체계적으로 운영하는 전 과정을 배웁니다.";
const landingLessonTitleOverrides: Record<string, string> = {
  "sns-22": "팔로워 규모별로 검토할 수익화 방식과 선택 기준",
  "sns-23": "브랜드 협업 준비 로드맵 — 팔로워 규모별 점검 항목",
  "sns-24": "단가 협상 실전편 — 제작 범위와 원고료 검토 기준",
  "sns-25": "광고 단가 협상 전에 확인할 5가지 기준",
  "sns-26": "브랜드 이메일·DM 제안서 작성 템플릿",
  "sns-30": "얼굴 공개 없이 운영하는 크리에이터의 콘텐츠 공통점",
};

export default async function Home() {
  const [courseCatalog, phonePassProduct] = await Promise.all([
    loadPublicCourseCatalog(),
    loadPublicProductBySlug(phonePassDefinition.slug),
  ]);
  const featuredItem = courseCatalog.find((item) => item.slug === featuredCourseSlug) ?? null;
  const pricingSlugs = new Set<string>(membershipPlanDefinitions.map((plan) => plan.slug));
  const enrollmentProducts = [
    ...courseCatalog
      .filter((item) => item.source === "database" && pricingSlugs.has(item.slug))
      .map((item) => ({
        slug: item.slug,
        priceKrw: item.priceKrw,
        soldOut: item.soldOut,
        checkoutHref: item.checkoutHref,
      })),
    ...(phonePassProduct
      ? [
          {
            slug: phonePassProduct.slug,
            priceKrw: phonePassProduct.priceKrw,
            soldOut: phonePassProduct.soldOut,
            checkoutHref: `/checkout?product=${encodeURIComponent(phonePassProduct.slug)}`,
          },
        ]
      : []),
  ];
  const sections = featuredItem?.course.sections ?? [];
  const lessonCount = sections.reduce(
    (total, section) => total + section.lessons.length,
    0
  );
  const courseTitle = featuredItem?.title ?? "이윰 SNS 수익화 클래스";

  return (
    <CourseEnrollmentProvider
      products={enrollmentProducts}
      complianceNotice={membershipEconomicOutcomeNotice}
    >
      <span id="top" />

      <SiteHeader variant="overlay" currentPath="/" useEnrollmentPicker />

      {/* ===== HERO ===== */}
      <header id="hero" style={{position: 'relative', background: '#F3EFE8', color: '#201C17', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '140px 40px 90px', overflow: 'hidden'}}>
        <div style={{position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden'}}><div style={{position: 'absolute', top: '-8%', left: '50%', transform: 'translateX(-50%)', width: '76vw', height: '66vh', background: 'radial-gradient(58% 58% at 50% 32%,rgba(217,130,94,0.18),rgba(217,130,94,0) 70%)', filter: 'blur(8px)'}}></div></div>
        <div style={{position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', overflow: 'hidden'}}><div className="serif" style={{fontSize: '34vw', lineHeight: '1', letterSpacing: '-0.04em', color: 'rgba(32,28,23,0.045)', whiteSpace: 'nowrap', animation: 'wmDrift 26s ease-in-out infinite'}}>yiyum</div></div>
        <div style={{position: 'relative', zIndex: '1', maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
          <div style={{overflow: 'hidden', marginBottom: '22px'}}><div style={{animation: 'fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) 0.1s both', fontSize: '17px', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#B85C38', fontWeight: '600'}}>{courseTitle}</div></div>

          <h1 className="serif" style={{fontSize: 'clamp(40px,7vw,88px)', lineHeight: '1.12', letterSpacing: '-0.01em', margin: '0', maxWidth: '14ch'}}>
            <span style={{display: 'block', overflow: 'hidden', paddingBottom: '6px'}}><span style={{display: 'block', animation: 'rise 1s cubic-bezier(0.16,1,0.3,1) 0.25s both'}}>차이는 팔로워</span></span>
            <span style={{display: 'block', overflow: 'hidden', paddingBottom: '6px'}}><span style={{display: 'block', animation: 'rise 1s cubic-bezier(0.16,1,0.3,1) 0.4s both'}}>수가 <span style={{color: '#B85C38'}}>아닙니다</span></span></span>
          </h1>

          <div className="hero-stats" style={{display: 'flex', justifyContent: 'center', alignItems: 'stretch', gap: '30px', marginTop: '52px', animation: 'fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) 0.85s both'}}>
            <div style={{width: '190px', textAlign: 'right'}}>
              <div style={{fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#A79F92', marginBottom: '10px'}}>흔한 착각</div>
              <div style={{fontSize: '16px', lineHeight: '1.55', color: '#938B7F'}}>팔로워 <span className="serif" style={{fontSize: '22px', color: '#57514A'}}>5만</span>이면{" "}<br className="bk" />수익화가 따라온다?</div>
            </div>
            <div style={{width: '1px', background: '#DDD5C8'}}></div>
            <div style={{width: '190px', textAlign: 'left'}}>
              <div style={{fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#B85C38', marginBottom: '10px'}}>강사 개인 운영 사례</div>
              <div style={{fontSize: '16px', lineHeight: '1.55', color: '#2E2820'}}><span className="serif" style={{fontSize: '22px', color: '#B85C38'}}>300</span>명대 첫 협찬 경험,{" "}<br className="bk" /><span className="serif" style={{fontSize: '22px', color: '#B85C38'}}>1,000</span>명대 협업 확장</div>
            </div>
          </div>

          <p style={{fontSize: '13px', lineHeight: '1.7', color: '#938B7F', margin: '20px auto 0', maxWidth: '520px', animation: 'fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) 0.95s both'}}>※ 팔로워 수와 협업 시점은 강사의 개인적인 과거 경험이며, 동일한 결과를 의미하지 않습니다.</p>
          <p style={{fontSize: '18px', lineHeight: '1.85', color: '#57514A', margin: '28px auto 0', maxWidth: '540px', animation: 'fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) 1s both'}}>“일단 팔로워부터 늘려.” 다들 이렇게 말하지만, 계정의 방향이 먼저예요.{" "}<br className="bk" />처음부터 <span style={{color: '#201C17', fontWeight: '600'}}>콘텐츠와 브랜드 협업 준비가 연결되는 구조</span>로 설계해야 해요.</p>

          <div style={{marginTop: '44px', animation: 'fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) 1.15s both'}}>
            <a href="#curriculum" style={{display: 'inline-flex', alignItems: 'center', gap: '12px', padding: '16px 32px', background: '#B85C38', color: '#F6F1E9', borderRadius: '100px', fontSize: '16px', fontWeight: '600', transition: 'transform 0.3s ease,box-shadow 0.3s ease', boxShadow: '0 8px 24px rgba(184,92,56,0.24)'}} className="cta-lift">{lessonCount > 0 ? `${lessonCount}강 커리큘럼 보기` : "커리큘럼 확인하기"}<span style={{fontSize: '18px'}}>→</span></a>
          </div>
        </div>
        <div style={{position: 'absolute', bottom: '34px', left: '0', right: '0', textAlign: 'center', fontSize: '11px', letterSpacing: '0.28em', textTransform: 'uppercase', color: '#A79F92', animation: 'fadeUp 1s ease 1.5s both'}}>Scroll</div>
      </header>

      {/* ===== 01 ABOUT ===== */}
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '150px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', gap: '20px', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '34px'}}>
          <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>01</span>
          <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>About</span>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(30px,4vw,50px)', lineHeight: '1.25', letterSpacing: '-0.01em', margin: '0 0 64px', maxWidth: '18ch'}}>작은 계정부터 시작하는 브랜드 협업 준비</h2>

        <div className="about-grid" style={{display: 'grid', gridTemplateColumns: '1fr 0.82fr', columnGap: '72px', rowGap: '40px', alignItems: 'stretch'}}>
          <p data-reveal="" className="serif" style={{gridColumn: '1 / -1', gridRow: '1', fontSize: 'clamp(22px,2.6vw,30px)', lineHeight: '1.6', letterSpacing: '-0.01em', margin: '0', color: '#201C17'}}>안녕하세요, 리빙 크리에이터 <span style={{color: '#B85C38'}}>이윰</span>입니다.{" "}<br className="bk" />리빙 인스타그램을 시작한 지 3주 만에 팔로워 1,000명, 12주 만에 1만 명을 넘겼어요.{" "}<br className="bk" />그리고 지금은 <span style={{color: '#B85C38'}}>100명이 넘는 수강생</span> 분과 함께 성장하고 있습니다.</p>
          <figure data-reveal="" data-reveal-delay="120" className="about-figure" style={{gridColumn: '2', gridRow: '2', margin: '0'}}>
            <div className="about-imgwrap" style={{overflow: 'hidden', borderRadius: '8px'}}><Image src="/assets/profile.jpg" width={1646} height={1646} sizes="(max-width: 760px) 100vw, 45vw" alt="리빙 크리에이터 이윰" className="about-img" /></div>
          </figure>
          <div data-reveal="" style={{gridColumn: '1', gridRow: '2'}}>
            <p style={{fontSize: '16.5px', lineHeight: '1.95', color: '#57514A', margin: '0 0 22px'}}>많은 분들이 ‘팔로워가 몇 만은 돼야 협찬이 들어온다’고 생각해요.{" "}<br className="bk" />제 개인 운영 경험으로는 팔로워 1,000명대부터 가구·가전 브랜드와 협업했고,{" "}<br className="bk" />이후 원고료가 포함된 유가 광고로 협업 범위를 넓혔습니다.</p>
            <div style={{background: '#201C17', borderRadius: '14px', padding: '24px 26px', margin: '0 0 20px', display: 'flex', gap: '14px', alignItems: 'flex-start'}}>
              <span aria-hidden="true" style={{fontSize: '20px', lineHeight: '1.9', flexShrink: '0'}}>💡</span>
              <p style={{fontSize: '16.5px', lineHeight: '1.9', color: '#EDE7DC', margin: '0'}}>비결은 팔로워를 먼저 모으고 수익화를 나중에 고민한 게 아니라,{" "}<br className="bk" />처음부터 <span style={{color: '#E9B48E', fontWeight: '600'}}>콘텐츠와 브랜드 협업 목표가 연결되도록</span> 계정을 설계했다는 것.{" "}<br className="bk" />그 차이를 이 강의에 전부 담았어요.</p>
            </div>
            <div style={{background: '#F5DCC7', border: '1px solid rgba(184,92,56,0.25)', borderRadius: '14px', padding: '24px 26px', margin: '0', display: 'flex', gap: '14px', alignItems: 'flex-start'}}>
              <span aria-hidden="true" style={{fontSize: '20px', lineHeight: '1.9', flexShrink: '0'}}>🎯</span>
              <div>
                <p style={{fontSize: '16.5px', lineHeight: '1.9', color: '#4A3324', margin: '0 0 16px'}}>진짜 차이는 계정을 설계하는 단계에서부터 수익 모델까지 함께 그렸는가에 있어요.</p>
                <p style={{fontSize: '16.5px', lineHeight: '1.9', color: '#4A3324', margin: '0 0 16px'}}>콘텐츠 하나를 올릴 때도, 팔로워 한 명이 늘 때도,{" "}<br className="bk" />그게 어디로 연결되는지 이미 정해져 있었어요.{" "}<br className="bk" />이 플로우를 이해하면 작은 계정에서도 콘텐츠의 방향과 협업 준비 기준을 구체화할 수 있어요.</p>
                <p style={{fontSize: '16.5px', lineHeight: '1.9', color: '#201C17', fontWeight: '600', margin: '0'}}>팔로워와 콘텐츠가 브랜드 협업 준비로 이어지도록 계정 구조를 설계하는 방법을 가르쳐드려요.</p>
              </div>
            </div>
          </div>
        </div>

        {/* 서명 (본문 아래, 좌측 컬럼 폭에 맞춤) */}
        <div style={{display: 'grid', gridTemplateColumns: '1fr 0.82fr', gap: '72px', marginTop: '40px'}}>
          <div data-reveal="" style={{display: 'flex', alignItems: 'center', gap: '16px', paddingTop: '28px', borderTop: '1px solid #DDD5C8'}}>
            <span className="serif" style={{fontSize: '30px', color: '#201C17'}}>이윰</span>
            <span style={{fontSize: '13px', letterSpacing: '0.04em', color: '#938B7F', lineHeight: '1.5'}}>리빙 크리에이터<br />SNS 수익화 코치<br />@yiyum_home</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px', paddingTop: '28px', borderTop: '1px solid #DDD5C8'}}>
            <div>
              <div style={{fontSize: '11px', letterSpacing: '0.04em', color: '#938B7F', marginBottom: '7px'}}>3주 만에</div>
              <div className="serif" style={{fontSize: 'clamp(26px,3.2vw,34px)', lineHeight: '1', color: '#201C17'}}>1,000</div>
              <div style={{fontSize: '12px', color: '#938B7F', marginTop: '6px'}}>팔로워</div>
            </div>
            <div>
              <div style={{fontSize: '11px', letterSpacing: '0.04em', color: '#938B7F', marginBottom: '7px'}}>7주차</div>
              <div className="serif" style={{fontSize: 'clamp(26px,3.2vw,34px)', lineHeight: '1', color: '#201C17'}}>5,000</div>
              <div style={{fontSize: '12px', color: '#938B7F', marginTop: '6px'}}>팔로워</div>
            </div>
            <div>
              <div style={{fontSize: '11px', letterSpacing: '0.04em', color: '#B85C38', marginBottom: '7px'}}>12주차</div>
              <div className="serif" style={{fontSize: 'clamp(26px,3.2vw,34px)', lineHeight: '1', color: '#B85C38'}}>10,000</div>
              <div style={{fontSize: '12px', color: '#938B7F', marginTop: '6px'}}>팔로워 달성</div>
            </div>
          </div>
        </div>


        {/* 강사 개인 협업 사례 */}
        <div style={{marginTop: '110px'}}>
          <div data-reveal="" style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#B85C38', fontWeight: '600', marginBottom: '16px'}}>강사 개인 운영 기록</div>
          <h3 data-reveal="" className="serif" style={{fontSize: 'clamp(26px,3.4vw,38px)', letterSpacing: '-0.01em', margin: '0 0 8px'}}>계정 성장 단계에서 겪은 협업 사례</h3>
          <p data-reveal="" style={{fontSize: '16px', color: '#938B7F', margin: '0 0 40px'}}>이윰이 직접 운영한 하나의 계정에서 나타난 과거 경험입니다.</p>

          <div style={{borderTop: '1px solid #201C17'}}>
            <div data-reveal="" style={{display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', padding: '26px 4px', borderBottom: '1px solid #DDD5C8', alignItems: 'baseline'}}>
              <span className="serif" style={{fontSize: '26px', color: '#201C17'}}>300<span style={{fontSize: '16px', color: '#938B7F'}}> 명대</span></span>
              <span style={{fontSize: '16px', lineHeight: '1.6', color: '#4E483F'}}>디퓨저 · 주방세제 · 얼룩제거제 · 수건 등 <span style={{color: '#B85C38'}}>첫 무가 협찬</span></span>
            </div>
            <div data-reveal="" style={{display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', padding: '26px 4px', borderBottom: '1px solid #DDD5C8', alignItems: 'baseline'}}>
              <span className="serif" style={{fontSize: '26px', color: '#201C17'}}>1,000<span style={{fontSize: '16px', color: '#938B7F'}}> 명대</span></span>
              <span style={{fontSize: '16px', lineHeight: '1.6', color: '#4E483F'}}>소파 · 식탁 · 거울 · 러그 · 선반 등 <span style={{color: '#B85C38'}}>가구 협찬 제안을 하루 3~5건 받은 경험</span></span>
            </div>
            <div data-reveal="" style={{display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', padding: '26px 4px', borderBottom: '1px solid #DDD5C8', alignItems: 'baseline'}}>
              <span className="serif" style={{fontSize: '26px', color: '#201C17'}}>2,000<span style={{fontSize: '16px', color: '#938B7F'}}> 명대</span></span>
              <span style={{fontSize: '16px', lineHeight: '1.6', color: '#4E483F'}}>릴스 제작에 <span style={{color: '#B85C38'}}>원고료가 포함된 유가 광고 협업을 시작</span></span>
            </div>
            <div data-reveal="" style={{display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', padding: '26px 4px', borderBottom: '1px solid #DDD5C8', alignItems: 'baseline'}}>
              <span className="serif" style={{fontSize: '26px', color: '#201C17'}}>3,000<span style={{fontSize: '16px', color: '#938B7F'}}> 명대</span></span>
              <span style={{fontSize: '16px', lineHeight: '1.6', color: '#4E483F'}}>브랜드 광고의 <span style={{color: '#B85C38'}}>원고료를 단계적으로 높여 협상한 경험</span></span>
            </div>
            <div data-reveal="" style={{display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', padding: '26px 4px', borderBottom: '1px solid #201C17', alignItems: 'baseline'}}>
              <span className="serif" style={{fontSize: '26px', color: '#201C17'}}>4,000<span style={{fontSize: '16px', color: '#938B7F'}}> 명대</span></span>
              <span style={{fontSize: '16px', lineHeight: '1.6', color: '#4E483F'}}><span style={{color: '#B85C38'}}>역제안으로 최초 제안보다 높은 조건을 협상</span>하고 식세기 · 냉장고 등 가전 협찬까지 확장</span>
            </div>
          </div>
          <p data-reveal="" style={{fontSize: '13px', lineHeight: '1.7', color: '#938B7F', margin: '18px 4px 0'}}>※ 위 내용은 강사의 개인 계정 운영 과정에서 발생한 과거 사례이며, 팔로워 수에 따른 협찬·광고·원고료를 보장하는 기준이 아닙니다.</p>
          <div data-reveal="" className="road-callout">
            <span className="road-callout-quote" aria-hidden="true">“</span>
            <p className="road-callout-text">제 수강생들은 <span style={{color: '#E9B48E'}}>200~300명의 작은 계정</span>에서도 각자의 프로필과 콘텐츠 방향, 제안 응대 방식을 점검해 왔어요.{" "}<br className="bk" />중요한 건 처음부터 <span style={{color: '#ffffff', fontWeight: '600'}}>브랜드가 계정을 검토할 때 살펴보는 요소</span>를 이해하고 준비하는 것!{" "}<br className="bk" />이 강의에서는 계정 설계부터 협업 제안 검토와 대응까지, 제가 실제로 사용한 판단 기준을 알려드려요.</p>
          </div>
        </div>
      </section>

      {/* ===== 02 WHO ===== */}
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '150px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', gap: '20px', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '34px'}}>
          <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>02</span>
          <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>For You?</span>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(30px,4vw,50px)', lineHeight: '1.25', letterSpacing: '-0.01em', margin: '0 0 64px', maxWidth: '18ch'}}>이 강의, 누구를 위한 걸까요</h2>
        <div className="ba">
          {/* 이런 분들께 권합니다 (hero) */}
          <div data-reveal="" className="ba-card ba-yes">
            <span className="ba-tag">이런 분들께 권합니다</span>
            <span className="ba-face" aria-hidden="true">🙌</span>
            <div className="ba-items">
              <div className="ba-item">팔로워가 적어 브랜드 협업 준비를 어디서 시작할지 막막한 분</div>
              <div className="ba-item">계정은 있는데 방향을 못 잡아 막막한 분</div>
              <div className="ba-item">늘 무가·저단가 제안만 와서 대응 기준이 필요한 분</div>
            </div>
          </div>
          {/* 이런 분들껜 맞지 않아요 (muted) */}
          <div data-reveal="" data-reveal-delay="140" className="ba-card ba-no">
            <span className="ba-tag">이런 분들껜 맞지 않아요</span>
            <span className="ba-face" aria-hidden="true">🙅</span>
            <div className="ba-items">
              <div className="ba-item">이미 협업 제안과 원고료 협상을 능숙하게 하는 분</div>
              <div className="ba-item">이미 계정 운영과 브랜드 협업 기준이 안정적으로 정리된 분</div>
              <div className="ba-item">팔로워 수 증가만 원하고 계정 방향과 협업 준비에는 관심 없는 분</div>
            </div>
          </div>
        </div>
      </section>

      {/* anchor:curriculum */}
      <span id="curriculum"></span>
      {/* ===== 03 CURRICULUM ===== */}
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '150px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '34px', flexWrap: 'wrap', gap: '16px'}}>
          <div style={{display: 'flex', alignItems: 'baseline', gap: '20px'}}>
            <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>03</span>
            <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>Curriculum</span>
          </div>
          <div style={{fontSize: '14px', color: '#57514A'}}>{sections.length}개 챕터 · 총 <span className="serif" style={{fontSize: '20px', color: '#201C17'}}>{lessonCount}</span>강</div>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(30px,4vw,50px)', lineHeight: '1.25', letterSpacing: '-0.01em', margin: '0 0 56px', maxWidth: '18ch'}}>{featuredItem ? landingCourseDescription : "공개된 커리큘럼을 확인해 보세요."}</h2>

        <div style={{borderTop: '1px solid #201C17'}}>
          {sections.length > 0 ? (
            sections.map((section, sectionIndex) => (
              <details
                key={section.id}
                open={sectionIndex === 0}
                style={{
                  borderBottom:
                    sectionIndex === sections.length - 1
                      ? '1px solid #201C17'
                      : '1px solid #DDD5C8',
                }}
              >
                <summary style={{display: 'flex', alignItems: 'center', gap: '24px', padding: '28px 4px'}}>
                  <span style={{flexShrink: '0', width: '58px'}}>
                    <span className="serif" style={{display: 'block', fontSize: '13px', fontStyle: 'italic', color: '#B49F8C', lineHeight: '1', marginBottom: '3px'}}>Chapter</span>
                    <span className="serif" style={{display: 'block', fontSize: '30px', color: '#B85C38', lineHeight: '1'}}>{String(sectionIndex + 1).padStart(2, "0")}</span>
                  </span>
                  <span style={{flex: '1'}}>
                    <span style={{fontSize: '22px', fontWeight: '600'}}>{section.title}</span>
                  </span>
                  <span className="chev" style={{fontSize: '22px', color: '#B85C38', fontWeight: '300'}}>+</span>
                </summary>
                <div className="cbody" style={{padding: '0 4px 30px 82px'}}>
                  {section.description && (
                    <p style={{margin: '0 0 10px', color: '#7C7367', fontSize: '14px', lineHeight: '1.7'}}>
                      {section.description}
                    </p>
                  )}
                  <ol style={{listStyle: 'none', padding: '0', margin: '0'}}>
                    {section.lessons.map((lesson, lessonIndex) => (
                      <li key={lesson.id} style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}>
                        <span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>{String(lessonIndex + 1).padStart(2, "0")}</span>
                        {landingLessonTitleOverrides[lesson.id] ?? lesson.title}
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            ))
          ) : (
            <div style={{padding: '48px 4px', borderBottom: '1px solid #201C17', color: '#938B7F', fontSize: '15px'}}>
              현재 공개된 커리큘럼을 준비하고 있습니다.
            </div>
          )}
        </div>
      </section>

      {/* ===== 04 REVIEWS ===== */}
      <span id="reviews"></span>
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '150px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', gap: '20px', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '40px'}}>
          <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>04</span>
          <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>Reviews</span>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(28px,3.6vw,42px)', letterSpacing: '-0.01em', margin: '0 0 8px', maxWidth: '16ch'}}>수강생들의 강의 후기</h2>
        <p data-reveal="" style={{fontSize: '16px', color: '#938B7F', margin: '0 0 48px'}}>오픈카톡방에서의 1:1 밀착 피드백이 가장 큰 메리트예요.</p>
        <ReviewMarquee alt="수강생 강의 후기" images={["/assets/reviews/review-01.jpg", "/assets/reviews/review-02.jpg", "/assets/reviews/review-03.jpg", "/assets/reviews/review-04.jpg", "/assets/reviews/review-05.jpg", "/assets/reviews/review-06.jpg", "/assets/reviews/review-07.jpg", "/assets/reviews/review-08.jpg", "/assets/reviews/review-09.jpg", "/assets/reviews/review-10.jpg", "/assets/reviews/review-13.jpg"]} />
      </section>

      {/* ===== 05 FAQ ===== */}
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '150px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', gap: '20px', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '34px'}}>
          <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>05</span>
          <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>FAQ</span>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(30px,4vw,50px)', lineHeight: '1.25', letterSpacing: '-0.01em', margin: '0 0 56px'}}>자주 묻는 질문</h2>
        <div style={{borderTop: '1px solid #201C17'}}>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>팔로워가 아예 없는 완전 왕초보인데 괜찮을까요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>네, Chapter 1(계정 세팅)부터 시작하기 때문에 팔로워 0명이신 분도 순서대로 학습하실 수 있어요. 초반부터 계정 운영과 협업 준비 기준을 함께 잡기 좋습니다. 다만 SNS와 동영상 편집 툴이 처음이라면 기능을 익히는 시간이 필요하고, 학습 속도와 적용 결과는 개인마다 다를 수 있어요.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>리빙 계정이 아니어도 들을 수 있나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>네, 사례는 리빙 계정을 기준으로 설명하지만 계정 설계와 브랜드 협업 준비의 원리는 다른 카테고리에도 응용할 수 있어요. 실제 적용 방식은 계정 주제와 상황에 따라 달라집니다.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>이미 운영 중인 계정이 있는데, 새로 계정을 파야 하나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>꼭 새 계정을 만들 필요는 없어요. 기존 계정의 방향성과 협업 준비 구조를 재정비할지, 새 계정으로 시작할지는 현재 상태에 따라 달라져요. 이를 판단하는 기준과 방법을 1강·2강에서 자세히 다룹니다.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>얼굴 노출 없이도 강의 내용을 적용할 수 있나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>네, 30강에서 얼굴을 공개하지 않고 운영하는 크리에이터들의 콘텐츠 구성 공통점을 다뤄요. 얼굴 공개가 부담스럽다면 해당 방식들을 참고해 본인 계정에 맞게 적용할 수 있습니다.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>랜딩페이지는 직접 만들어주시나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>직접 제작해드리는 서비스는 아니며, 4강에서 랜딩페이지의 목적과 기본 구조, 만드는 방법을 알려드려요. 수강생이 직접 자신의 계정과 상품에 맞춰 적용하는 교육 과정입니다.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>원고료는 어떤 기준으로 검토하나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>강의에서 특정 원고료를 제시하거나 보장하지 않아요. 계정과 제안 조건마다 다르기 때문에, 실제 협업에서 확인해야 할 제작 범위·사용 기간·수정 횟수와 협상 문구를 다룹니다.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>강의만 들으면 바로 협찬이 들어오나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>아니요. 수강만으로 협찬·광고 등 특정 성과가 발생한다고 보장하지 않아요. 이 강의는 제가 경험한 계정 설계, 콘텐츠 운영, 제안 검토 기준을 교육 자료로 제공하며 실제 결과는 계정 상태와 활동 내용, 시장 상황에 따라 달라질 수 있습니다.</div></details>
          <details style={{borderBottom: '1px solid #201C17'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>협찬·광고 수익 세금 처리는 어떻게 하나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>강의에서는 세금 관리 시 확인할 기본 사항과 전문가 상담이 필요한 지점을 소개해요. 개인 상황에 따른 신고·세무 판단은 세무 전문가와 별도로 확인해야 합니다.</div></details>
        </div>
      </section>

      {/* ===== 06 APPLY ===== */}
      <section id="apply" style={{marginTop: '150px', padding: '120px 40px', background: '#1B1815', color: '#EDE7DC', textAlign: 'center'}} aria-labelledby="apply-title">
        <div data-reveal="" style={{maxWidth: '700px', margin: '0 auto'}}>
          <span style={{display: 'block', marginBottom: '18px', color: '#D9825E', fontSize: '11px', fontWeight: '700', letterSpacing: '0.2em'}}>READY TO START?</span>
          <h2 id="apply-title" className="serif" style={{fontSize: 'clamp(34px,5vw,56px)', lineHeight: '1.2', margin: '0'}}>이 강의가 필요하다고 느껴졌다면</h2>
          <p style={{maxWidth: '560px', margin: '20px auto 32px', color: '#BDB3A7', fontSize: '16px', lineHeight: '1.8'}}>먼저 강의를 충분히 살펴본 뒤 신청해 주세요. 버튼을 누르면 VOD, 피드백, 초밀착 중 나에게 맞는 수강 방식을 비교할 수 있어요.</p>
          <CourseEnrollmentPicker
            triggerLabel="수강 방식 선택"
          />
        </div>
      </section>

      <SiteFooter />

      {/* sticky buy bar */}
      {featuredItem && (
        <div id="buyBar" style={{position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: '70', background: 'rgba(27,24,21,0.94)', backdropFilter: 'blur(12px)', color: '#EDE7DC', transform: 'translateY(130%)', transition: 'transform 0.5s cubic-bezier(0.16,1,0.3,1)'}}>
          <div style={{maxWidth: '1200px', margin: '0 auto', padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px'}}>
            <div style={{display: 'flex', alignItems: 'baseline', gap: '14px', minWidth: '0'}}>
              <span style={{fontSize: '14px', color: '#EDE7DC', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{courseTitle}</span>
              <span style={{fontSize: '12px', color: '#9A9082', whiteSpace: 'nowrap'}}>신청 단계에서 수강 방식 선택</span>
            </div>
            <CourseEnrollmentPicker
              triggerLabel="수강 신청"
              triggerVariant="compact"
            />
          </div>
        </div>
      )}

      <LandingInteractions />
    </CourseEnrollmentProvider>
  );
}
