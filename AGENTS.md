<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- AI support is review-only: fetch production context through the authenticated user's existing reads, never mutate MES records, and enforce existing permissions server-side to preserve workflow authority.
- OpenAI calls use server-only Responses SDK helpers and streamed NDJSON through authenticated server functions; persist terminal provider denials in service-only access state to prevent automatic replay across restarts.
