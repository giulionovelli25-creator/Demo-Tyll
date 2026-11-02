import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-panel border border-line bg-paper p-8 text-center shadow-panel">
      <h1 className="text-title font-medium text-ink">This page does not exist</h1>
      <p className="mt-2 text-sm text-graphite">The link may be old. Home has everything that needs you today.</p>
      <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-medium text-on-accent transition-colors duration-200 hover:bg-accent-hover">Go to Home</Link>
    </div>
  );
}
