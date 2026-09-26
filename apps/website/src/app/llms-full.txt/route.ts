import { getLlmsFull } from '@/lib/llms';

export const dynamic = 'force-static';

export function GET() {
  return new Response(getLlmsFull(), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
