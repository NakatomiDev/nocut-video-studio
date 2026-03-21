import { CreditCard } from "lucide-react";

const Credits = () => (
  <div className="p-6 lg:p-8">
    <h1 className="text-2xl font-bold text-foreground">Credits</h1>
    <div className="mt-24 flex flex-col items-center justify-center text-center">
      <CreditCard className="h-12 w-12 text-muted-foreground" />
      <p className="mt-4 text-muted-foreground">Credits page coming soon</p>
    </div>
  </div>
);

export default Credits;
