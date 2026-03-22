import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const disclosureItems = [
  { label: "販売事業者 (Business Name)", value: "合同会社Nakatomi (Nakatomi LLC)" },
  { label: "代表者 (Representative)", value: "中冨 太郎" },
  { label: "所在地 (Address)", value: "〒150-0001 東京都渋谷区神宮前6丁目23-4 桑野ビル2階" },
  { label: "電話番号 (Phone)", value: "お問い合わせはメールにて承ります。" },
  { label: "メールアドレス (Email)", value: "support@nakatomi.dev" },
  { label: "運営統括責任者 (Head of Operations)", value: "中冨 太郎" },
  {
    label: "販売価格 (Pricing)",
    value:
      "各サービスページに記載された価格に準じます。価格はすべて税込み表示です。\nPrices are as listed on each service page. All prices include applicable taxes.",
  },
  {
    label: "支払方法 (Payment Methods)",
    value: "クレジットカード（Visa, Mastercard, American Express, JCB）",
  },
  {
    label: "支払時期 (Payment Timing)",
    value:
      "クレジットカード決済：ご注文時に即時決済。サブスクリプション：毎月の更新日に自動決済。\nCredit card: charged immediately at time of purchase. Subscriptions: charged automatically on each renewal date.",
  },
  {
    label: "商品の引渡し時期 (Delivery)",
    value:
      "デジタルサービスのため、決済完了後すぐにご利用いただけます。\nAs a digital service, access is granted immediately upon payment completion.",
  },
  {
    label: "返品・キャンセルについて (Returns & Cancellations)",
    value:
      "デジタルサービスの性質上、購入後の返品・返金は原則としてお受けしておりません。サブスクリプションはいつでもキャンセル可能で、次回更新日以降の請求は発生しません。未使用クレジットの返金は行っておりません。\nDue to the nature of digital services, refunds are generally not available after purchase. Subscriptions may be cancelled at any time and billing will stop at the next renewal date. Unused credits are non-refundable.",
  },
  {
    label: "動作環境 (System Requirements)",
    value:
      "最新版のGoogle Chrome、Firefox、Safari、Microsoft Edgeが動作するPC環境。安定したインターネット接続が必要です。\nA PC running the latest version of Google Chrome, Firefox, Safari, or Microsoft Edge. A stable internet connection is required.",
  },
];

const CommercialDisclosure = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl">✂️</span>
            <span className="text-xl font-bold tracking-tight">NoCut</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/sign-in">
              <Button variant="ghost" size="sm">Sign In</Button>
            </Link>
            <Link to="/sign-up">
              <Button size="sm" className="bg-primary hover:bg-primary/90">
                Get Started Free
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold sm:text-4xl">特定商取引法に基づく表記</h1>
          <p className="mt-2 text-muted-foreground">Commercial Disclosure</p>

          <div className="mt-12 divide-y divide-border/50">
            {disclosureItems.map(({ label, value }) => (
              <div key={label} className="py-6 grid gap-2 sm:grid-cols-3 sm:gap-6">
                <dt className="text-sm font-medium text-foreground">{label}</dt>
                <dd className="text-sm text-muted-foreground sm:col-span-2 whitespace-pre-line">
                  {value}
                </dd>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-card/20 py-12 px-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="text-lg">✂️</span>
            <span className="font-bold">NoCut</span>
            <span className="text-sm text-muted-foreground ml-2">One Take. Every Time.</span>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            <Link to="/commercial-disclosure" className="hover:text-foreground transition-colors">Commercial Disclosure</Link>
            <a href="#" className="hover:text-foreground transition-colors">Support</a>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 NoCut. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default CommercialDisclosure;
