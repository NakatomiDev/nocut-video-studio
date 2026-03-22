import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check, Coins, Sparkles, Film, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    credits: 5,
    features: [
      "5 credits/mo",
      "720p export",
      "5 min max input",
      "1s AI fills",
      "3 exports/mo (watermarked)",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 14.99,
    annualPrice: 9.99,
    credits: 40,
    features: [
      "40 credits/mo",
      "1080p export",
      "30 min max input",
      "5s AI fills",
      "Transcript editing",
      "Unlimited exports, no watermark",
    ],
    highlight: true,
  },
  {
    id: "business",
    name: "Business",
    monthlyPrice: 39.99,
    annualPrice: 29.99,
    credits: 120,
    features: [
      "120 credits/mo",
      "4K export",
      "2 hour max input",
      "5s AI fills",
      "Multi-speaker support",
      "Batch processing",
      "Priority processing",
    ],
  },
];

const TOPUP_PACKS = [
  { credits: 10, price: "$4.99", perCredit: "$0.50", name: "Starter" },
  { credits: 40, price: "$14.99", perCredit: "$0.37", name: "Standard", badge: "Most Popular" },
  { credits: 100, price: "$34.99", perCredit: "$0.35", name: "Pro", badge: "Best Value" },
  { credits: 250, price: "$79.99", perCredit: "$0.32", name: "Studio" },
];

const Index = () => {
  const { session, loading } = useAuth();
  const [annual, setAnnual] = useState(true);

  if (loading) return null;
  if (session) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Film className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">NoCut Studio</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/sign-in">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/sign-up">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center">
        <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">AI-Powered Video Editing</Badge>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Edit videos without cutting
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
          Remove filler words, long pauses, and mistakes — NoCut uses AI to seamlessly fill gaps so your video flows naturally.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button size="lg" asChild>
            <Link to="/sign-up">Start for free</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="#pricing">See pricing</a>
          </Button>
        </div>
      </section>

      {/* Features row */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { icon: Scissors, title: "Smart Gap Removal", desc: "Automatically detect and remove filler words, pauses, and retakes from your footage." },
            { icon: Sparkles, title: "AI Fill", desc: "Generate seamless video to bridge gaps — powered by state-of-the-art generative models." },
            { icon: Coins, title: "Pay-As-You-Go Credits", desc: "Monthly credits included with every plan, plus flexible top-up packs when you need more." },
          ].map(({ icon: Icon, title, desc }) => (
            <Card key={title} className="border-border">
              <CardContent className="pt-6 space-y-2">
                <Icon className="h-8 w-8 text-primary" />
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-bold text-center">Pricing</h2>
          <p className="mt-2 text-center text-muted-foreground">Choose a plan, top up when you need more.</p>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3 mt-8">
            <span className={cn("text-sm", !annual && "text-foreground font-medium", annual && "text-muted-foreground")}>Monthly</span>
            <Switch checked={annual} onCheckedChange={setAnnual} />
            <span className={cn("text-sm", annual && "text-foreground font-medium", !annual && "text-muted-foreground")}>Annual</span>
            {annual && <Badge className="bg-primary/20 text-primary text-[10px]">Save 33%</Badge>}
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
            {PLANS.map((plan) => {
              const price = annual ? plan.annualPrice : plan.monthlyPrice;
              return (
                <Card
                  key={plan.id}
                  className={cn(
                    "border-border relative",
                    plan.highlight && "border-primary ring-1 ring-primary",
                  )}
                >
                  {plan.highlight && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px]">
                      Recommended
                    </Badge>
                  )}
                  <CardContent className="pt-6 pb-5 space-y-5">
                    <div>
                      <p className="text-lg font-bold">{plan.name}</p>
                      <div className="mt-1">
                        {price === 0 ? (
                          <span className="text-3xl font-bold">Free</span>
                        ) : (
                          <>
                            <span className="text-3xl font-bold">${price.toFixed(2)}</span>
                            <span className="text-sm text-muted-foreground">/mo</span>
                          </>
                        )}
                      </div>
                      {annual && plan.monthlyPrice > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          ${(plan.annualPrice * 12).toFixed(2)}/yr (billed annually)
                        </p>
                      )}
                    </div>
                    <ul className="space-y-2 text-sm">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-muted-foreground">
                          <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Button className="w-full" variant={plan.highlight ? "default" : "outline"} asChild>
                      <Link to="/sign-up">
                        {plan.id === "free" ? "Get started" : `Start with ${plan.name}`}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Top-Up Credits */}
          <div className="mt-16">
            <h3 className="text-2xl font-bold text-center">Top-Up Credit Packs</h3>
            <p className="mt-2 text-center text-muted-foreground">
              Need more credits? Buy packs anytime — no subscription required.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
              {TOPUP_PACKS.map((pack) => (
                <Card key={pack.name} className="border-border relative overflow-hidden">
                  {pack.badge && (
                    <Badge className="absolute top-3 right-3 bg-primary text-primary-foreground text-[10px]">
                      {pack.badge}
                    </Badge>
                  )}
                  <CardContent className="pt-6 pb-5 space-y-3">
                    <div>
                      <p className="text-2xl font-bold">{pack.credits} credits</p>
                      <p className="text-sm text-muted-foreground">{pack.name}</p>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold">{pack.price}</span>
                      <span className="text-xs text-muted-foreground">{pack.perCredit}/credit</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Credit explainer */}
          <div className="mt-12 text-center text-sm text-muted-foreground max-w-2xl mx-auto space-y-1">
            <p>Credits are model-weighted: 1 credit = 1 sec of fast generation, up to 6 credits/sec for premium audio models.</p>
            <p>Monthly credits expire after 60 days. Top-up credits expire after 90 days.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between text-sm text-muted-foreground">
          <span>NoCut Studio</span>
          <div className="flex gap-4">
            <Link to="/sign-in" className="hover:text-foreground">Sign in</Link>
            <Link to="/sign-up" className="hover:text-foreground">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
