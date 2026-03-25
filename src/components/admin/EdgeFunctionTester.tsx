import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const KNOWN_FUNCTIONS = [
  "credits-balance",
  "credits-history",
  "credits-topup",
  "export-video",
  "get-signed-url",
  "preview-fill",
  "process-ai-fill",
  "project-edl",
  "project-estimate",
  "subscribe-checkout",
  "test-veo-transition",
  "upload-chunk-complete",
  "upload-complete",
  "upload-initiate",
];

const EdgeFunctionTester = () => {
  const [functionName, setFunctionName] = useState(KNOWN_FUNCTIONS[0]);
  const [body, setBody] = useState("{}");
  const [method, setMethod] = useState<"POST" | "GET">("POST");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const handleInvoke = async () => {
    setLoading(true);
    setResponse(null);
    setResponseStatus(null);
    const start = performance.now();

    try {
      let parsedBody: unknown = undefined;
      if (method === "POST" && body.trim()) {
        parsedBody = JSON.parse(body);
      }

      const { data, error } = await supabase.functions.invoke(functionName, {
        body: parsedBody,
        method,
      });

      const ms = Math.round(performance.now() - start);
      setElapsed(ms);

      if (error) {
        setResponseStatus(error.context?.status ?? 500);
        setResponse(JSON.stringify({ error: error.message }, null, 2));
      } else {
        setResponseStatus(200);
        setResponse(JSON.stringify(data, null, 2));
      }
    } catch (err) {
      setElapsed(Math.round(performance.now() - start));
      setResponseStatus(0);
      setResponse((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base">Invoke Edge Function</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Label>Function</Label>
              <select value={functionName} onChange={(e) => setFunctionName(e.target.value)} className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {KNOWN_FUNCTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <Label>Method</Label>
              <select value={method} onChange={(e) => setMethod(e.target.value as "POST" | "GET")} className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </div>
          </div>

          {method === "POST" && (
            <div>
              <Label>Request Body (JSON)</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="mt-1 font-mono text-xs" placeholder='{"key": "value"}' />
            </div>
          )}

          <Button onClick={handleInvoke} disabled={loading} className="w-full gap-2">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Invoking...</> : <><Send className="h-4 w-4" />Invoke</>}
          </Button>
        </CardContent>
      </Card>

      {response !== null && (
        <Card className={responseStatus && responseStatus >= 200 && responseStatus < 300 ? "border-green-500/40" : "border-destructive/40"}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Response</span>
              <span className="text-xs font-normal text-muted-foreground">
                {responseStatus !== null && `Status ${responseStatus}`} · {elapsed}ms
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-lg bg-secondary p-4 text-xs text-foreground">{response}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EdgeFunctionTester;
