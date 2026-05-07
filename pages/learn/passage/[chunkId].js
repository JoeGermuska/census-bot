// pages/learn/passage/[chunkId].js — in-app passage view: focal chunk + neighbors.
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import SiteLayout from "../../../components/SiteLayout";
import landing from "../../../styles/Landing.module.css";

export default function Passage() {
  const router = useRouter();
  const { chunkId } = router.query;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!chunkId || typeof chunkId !== "string") return;
    let cancelled = false;
    setError(null);
    setData(null);
    fetch(`/api/acs-passage?id=${encodeURIComponent(chunkId)}`)
      .then(async r => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
        if (!cancelled) setData(json);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      });
    return () => { cancelled = true; };
  }, [chunkId]);

  const title = data?.doc?.title || "Loading passage…";
  const pdfHref = data?.doc?.has_pdf
    ? `/docs/${data.doc.id}.pdf${data.focal?.page ? `#page=${data.focal.page}` : ""}`
    : data?.doc?.url;

  return (
    <>
      <Head>
        <title>{`CensusBot — ${data?.doc?.title || "Passage"}`}</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <SiteLayout>
        <div className={landing.passageWrap}>
          <div className={landing.passageBreadcrumb}>
            <Link href="/learn">← Back to Learn</Link>
          </div>

          {error && <div className={landing.errorBox}>{error}</div>}

          {!error && (
            <>
              <div className={landing.passageHeader}>
                <div className={landing.passageDocTitle}>{title}</div>
                <div className={landing.passageMeta}>
                  {data?.focal?.page != null && <span>Page {data.focal.page}</span>}
                  {data?.doc?.kind && <span>{data.doc.kind}</span>}
                </div>
                {pdfHref && (
                  <a
                    className={landing.passagePdfLink}
                    href={pdfHref}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {data?.doc?.has_pdf ? "View original PDF →" : "View on census.gov →"}
                  </a>
                )}
              </div>

              {data?.prev && (
                <div className={`${landing.passageBlock} ${landing.passageBlockNeighbor}`}>
                  <div className={landing.passageNeighborLabel}>
                    Previous passage{data.prev.page != null ? ` · p.${data.prev.page}` : ""}
                  </div>
                  {data.prev.text}
                </div>
              )}

              {data?.focal && (
                <div className={`${landing.passageBlock} ${landing.passageBlockFocal}`}>
                  {data.focal.text}
                </div>
              )}

              {data?.next && (
                <div className={`${landing.passageBlock} ${landing.passageBlockNeighbor}`}>
                  <div className={landing.passageNeighborLabel}>
                    Next passage{data.next.page != null ? ` · p.${data.next.page}` : ""}
                  </div>
                  {data.next.text}
                </div>
              )}
            </>
          )}
        </div>
      </SiteLayout>
    </>
  );
}
