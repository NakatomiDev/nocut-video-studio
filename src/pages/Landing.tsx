import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Play, Scissors, Sparkles, Zap, Clock, Shield, ChevronRight, Check, Coins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import heroMockup from "@/assets/hero-editor-mockup.png";
import beforeAfter from "@/assets/before-after-mockup.png";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: "easeOut" },
  }),
};

const Landing = () => {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✂️</span>
            <span className="text-xl font-bold tracking-tight">NoCut</span>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
          </div>
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

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6">
        {/* Background gradient orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-primary/10 blur-[120px]" />
          <div className="absolute top-60 -left-40 w-[400px] h-[400px] rounded-full bg-primary/5 blur-[100px]" />
        </div>

        <div className="relative mx-auto max-w-7xl">
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={0}
          >
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              AI-Powered Video Continuity
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
              One Take.
              <br />
              <span className="bg-gradient-to-r from-primary to-[hsl(280,80%,70%)] bg-clip-text text-transparent">
                Every Time.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground leading-relaxed">
              Stop re-recording. NoCut uses AI to generate seamless bridging footage that makes your final video look like one perfect, uninterrupted take.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link to="/sign-up">
                <Button size="lg" className="h-12 px-8 text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25">
                  Start Editing Free
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button variant="outline" size="lg" className="h-12 px-8 text-base border-border hover:bg-secondary">
                  <Play className="mr-2 h-4 w-4" />
                  See How It Works
                </Button>
              </a>
            </div>
          </motion.div>

          {/* Hero Image */}
          <motion.div
            className="relative mx-auto mt-16 max-w-5xl"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.8, ease: "easeOut" }}
          >
            <div className="rounded-xl border border-border/50 bg-card/50 p-2 shadow-2xl shadow-primary/5 backdrop-blur">
              <img
                src={heroMockup}
                alt="NoCut timeline editor showing AI-generated fill segments on a professional video editing interface"
                className="w-full rounded-lg"
                loading="eager"
              />
            </div>
            {/* Floating stats */}
            <motion.div
              className="absolute -bottom-6 -left-4 rounded-lg border border-border bg-card px-4 py-3 shadow-xl sm:-left-8"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.8, duration: 0.5 }}
            >
              <p className="text-xs text-muted-foreground">Time saved per video</p>
              <p className="text-2xl font-bold text-primary">73%</p>
            </motion.div>
            <motion.div
              className="absolute -bottom-6 -right-4 rounded-lg border border-border bg-card px-4 py-3 shadow-xl sm:-right-8"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.9, duration: 0.5 }}
            >
              <p className="text-xs text-muted-foreground">AI Fill accuracy</p>
              <p className="text-2xl font-bold text-primary">99.2%</p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="border-y border-border/50 bg-card/30 py-10 px-6">
        <div className="mx-auto max-w-5xl text-center">
          <p className="text-sm text-muted-foreground mb-6">Trusted by creators who value their time</p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-muted-foreground/60">
            {["YouTubers", "Course Creators", "Podcasters", "Streamers", "Agencies"].map((label) => (
              <span key={label} className="text-sm font-medium tracking-wider uppercase">{label}</span>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 px-6">
        <div className="mx-auto max-w-7xl">
          <motion.div
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
          >
            <h2 className="text-3xl font-bold sm:text-4xl">
              Three Steps to a{" "}
              <span className="text-primary">Perfect Take</span>
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
              Upload your raw footage, let AI detect the cuts, review and export — it's that simple.
            </p>
          </motion.div>

          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                step: "01",
                icon: <Scissors className="h-6 w-6" />,
                title: "Upload & Auto-Detect",
                desc: "Upload your raw video. Our AI instantly detects every pause, filler word, and false start — marking cut points automatically.",
              },
              {
                step: "02",
                icon: <Sparkles className="h-6 w-6" />,
                title: "Review & AI Fill",
                desc: "Fine-tune cuts on the timeline editor. Hit 'Generate' and AI creates seamless bridging footage for every gap.",
              },
              {
                step: "03",
                icon: <Zap className="h-6 w-6" />,
                title: "Export Your One-Take",
                desc: "Export a clean, continuous video that looks like it was recorded in a single perfect take. No jump cuts. No reshoots.",
              },
            ].map(({ step, icon, title, desc }, i) => (
              <motion.div
                key={step}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
              >
                <Card className="group relative border-border/50 bg-card/50 hover:border-primary/30 transition-all duration-300 h-full">
                  <CardContent className="p-8">
                    <div className="mb-4 flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                        {icon}
                      </div>
                      <span className="text-4xl font-black text-border/80">{step}</span>
                    </div>
                    <h3 className="mt-2 text-xl font-semibold">{title}</h3>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Before / After */}
      <section className="py-24 px-6 bg-card/20">
        <div className="mx-auto max-w-5xl">
          <motion.div
            className="text-center mb-12"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
          >
            <h2 className="text-3xl font-bold sm:text-4xl">
              From <span className="text-destructive">Jump Cuts</span> to{" "}
              <span className="text-primary">Seamless Flow</span>
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
              See the difference AI-generated fills make on your timeline.
            </p>
          </motion.div>
          <motion.div
            className="rounded-xl border border-border/50 bg-card/50 p-2 shadow-xl"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <img
              src={beforeAfter}
              alt="Before: timeline with visible jump cuts. After: seamless timeline with AI-generated bridging footage"
              className="w-full rounded-lg"
              loading="lazy"
            />
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 px-6">
        <div className="mx-auto max-w-7xl">
          <motion.div
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
          >
            <h2 className="text-3xl font-bold sm:text-4xl">Built for Creators Who Ship</h2>
            <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
              Professional-grade tools that feel fast, focused, and precise.
            </p>
          </motion.div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: <Scissors className="h-5 w-5" />, title: "Smart Cut Detection", desc: "AI identifies pauses, filler words, and retakes automatically — no manual scrubbing." },
              { icon: <Sparkles className="h-5 w-5" />, title: "AI Video Fill", desc: "Generates natural-looking bridging footage from your own video — same speaker, same setting." },
              { icon: <Clock className="h-5 w-5" />, title: "Save 70%+ Time", desc: "What took hours of re-recording now takes minutes with AI-generated fills." },
              { icon: <Shield className="h-5 w-5" />, title: "C2PA Certified", desc: "Every export includes content credentials marking AI-generated segments. Full transparency." },
              { icon: <Zap className="h-5 w-5" />, title: "Editor-Grade Timeline", desc: "Precision waveform editor with frame-accurate control. Feels like a pro NLE." },
              { icon: <Play className="h-5 w-5" />, title: "Instant Preview", desc: "Review AI fills inline before exporting. Adjust, regenerate, or approve in seconds." },
            ].map(({ icon, title, desc }, i) => (
              <motion.div
                key={title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-30px" }}
                variants={fadeUp}
                custom={i}
              >
                <Card className="border-border/50 bg-card/50 hover:border-primary/20 transition-colors h-full">
                  <CardContent className="p-6">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {icon}
                    </div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6 bg-card/20">
        <div className="mx-auto max-w-5xl">
          <motion.div
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
          >
            <h2 className="text-3xl font-bold sm:text-4xl">Simple, Credit-Based Pricing</h2>
            <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
              Start free. Pay only for the AI fills you use.
            </p>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                name: "Free",
                price: "$0",
                period: "forever",
                credits: "5 credits/month",
                features: ["720p export", "Up to 5 min videos", "≤ 1s AI fills", "Watermarked exports"],
                cta: "Get Started",
                highlight: false,
              },
              {
                name: "Pro",
                price: "$14.99",
                period: "/month",
                credits: "40 credits/month",
                features: ["1080p export", "Up to 30 min videos", "≤ 5s AI fills", "No watermark", "Transcript editing"],
                cta: "Start Pro Trial",
                highlight: true,
              },
              {
                name: "Business",
                price: "$39.99",
                period: "/month",
                credits: "120 credits/month",
                features: ["4K export", "Up to 2hr videos", "≤ 5s AI fills", "Multi-speaker support", "Batch processing", "Priority rendering"],
                cta: "Go Business",
                highlight: false,
              },
            ].map(({ name, price, period, credits, features, cta, highlight }, i) => (
              <motion.div
                key={name}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-30px" }}
                variants={fadeUp}
                custom={i}
              >
                <Card
                  className={`relative h-full transition-all duration-300 ${
                    highlight
                      ? "border-primary bg-card shadow-xl shadow-primary/10 scale-[1.02]"
                      : "border-border/50 bg-card/50 hover:border-primary/20"
                  }`}
                >
                  {highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground">
                      Most Popular
                    </div>
                  )}
                  <CardContent className="p-8">
                    <h3 className="text-lg font-semibold">{name}</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold">{price}</span>
                      <span className="text-sm text-muted-foreground">{period}</span>
                    </div>
                    <p className="mt-2 text-sm text-primary font-medium">{credits}</p>
                    <ul className="mt-6 space-y-3">
                      {features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Link to="/sign-up" className="block mt-8">
                      <Button
                        className={`w-full ${highlight ? "bg-primary hover:bg-primary/90" : ""}`}
                        variant={highlight ? "default" : "outline"}
                      >
                        {cta}
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Credit Top-Ups */}
          <motion.div
            className="mt-16 text-center"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            custom={0}
          >
            <h3 className="text-2xl font-bold">Need More Credits?</h3>
            <p className="mx-auto mt-2 max-w-md text-muted-foreground">
              Top up anytime — no subscription required.
            </p>
          </motion.div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { credits: 10, price: "$4.99", perCredit: "$0.50", name: "Starter" },
              { credits: 40, price: "$14.99", perCredit: "$0.37", name: "Standard", badge: "Most Popular" },
              { credits: 100, price: "$34.99", perCredit: "$0.35", name: "Pro", badge: "Best Value" },
              { credits: 250, price: "$79.99", perCredit: "$0.32", name: "Studio" },
            ].map(({ credits, price, perCredit, name, badge }, i) => (
              <motion.div
                key={name}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-30px" }}
                variants={fadeUp}
                custom={i}
              >
                <Card className="relative h-full border-border/50 bg-card/50 hover:border-primary/20 transition-all duration-300">
                  {badge && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2" variant="secondary">
                      {badge}
                    </Badge>
                  )}
                  <CardContent className="p-6 text-center">
                    <Coins className="mx-auto h-8 w-8 text-primary mb-3" />
                    <h4 className="font-semibold">{name}</h4>
                    <p className="mt-1 text-3xl font-extrabold">{credits}</p>
                    <p className="text-xs text-muted-foreground">credits</p>
                    <p className="mt-3 text-lg font-bold">{price}</p>
                    <p className="text-xs text-muted-foreground">{perCredit}/credit</p>
                    <Link to="/sign-up" className="block mt-4">
                      <Button variant="outline" size="sm" className="w-full">
                        Buy Credits
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-6">
        <div className="mx-auto max-w-3xl text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
          >
            <h2 className="text-3xl font-bold sm:text-4xl">
              Stop Re-Recording.
              <br />
              <span className="text-primary">Start Shipping.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-md text-muted-foreground">
              Join thousands of creators who save hours every week with AI-powered video continuity.
            </p>
            <Link to="/sign-up" className="inline-block mt-8">
              <Button size="lg" className="h-12 px-10 text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25">
                Get Started Free
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

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

export default Landing;
