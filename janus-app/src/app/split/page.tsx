import { Suspense } from "react";
import SplitPage from "./new/page";

export default function SplitRootPage() {
  return (
    <Suspense fallback={null}>
      <SplitPage />
    </Suspense>
  );
}
