import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const disclosureItems = [
  { label: "販売業者（事業者）名", value: "Ｎａｋａｔｏｍｉ株式会社" },
  { label: "所在地（住所）", value: "東京都港区元麻布３丁目１番６号" },
  { label: "電話番号", value: "090-9952-1444（受付時間：平日 10:00〜18:00 など）" },
  { label: "メールアドレス", value: "contact@nakatomi.dev" },
  { label: "サービス提供URL", value: "https://nakatomi.dev/" },
  { label: "代表責任者名", value: "リチャード・オーマン" },
  {
    label: "販売価格",
    value:
      "各サービスページに税込価格で表示（例：Free, Pay-as-you-grow, Corporate Starter, Compliance Pro）",
  },
  {
    label: "役務の内容および提供時期",
    value:
      "Webサービス／SaaS。決済確定後、速やかにサービスを利用開始できます。",
  },
  {
    label: "お支払い方法および支払い時期",
    value:
      "・クレジットカード決済：決済完了時に確定\n・銀行振込（国内銀行）：請求日より3日以内にお支払いください（例：3日以内）",
  },
  {
    label: "追加料金（該当する場合）",
    value: "なし（手数料・送料等の追加料金はかかりません）",
  },
  {
    label: "契約の申込み有効期限",
    value:
      "銀行振込の場合、請求日より3日以内に入金がない場合は注文をキャンセル扱いとします。",
  },
  {
    label: "解約・キャンセルについて",
    value:
      "ご利用プランはいつでもキャンセル可能です。\nキャンセル申請後、当該請求期間の終了をもってサービスのご利用は停止となります。\nなお、お支払い済の料金については返金いたしません。",
  },
  {
    label: "事業者の責任",
    value:
      "サービスに不具合があった場合、利用規約に従い対応いたします。また、サービスの仕様や提供体制の変更がある場合は事前に通知いたします。",
  },
  {
    label: "動作環境（該当する場合）",
    value:
      "本サービスはモダンな Web ブラウザ（Chrome / Edge / Firefox / Safari 最新版など）で正常に動作します。JavaScript や Cookie を有効にしてください。",
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
          <p className="text-xs text-muted-foreground">© 2026 NoCut by Nakatomi K.K. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default CommercialDisclosure;
