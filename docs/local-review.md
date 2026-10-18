# Local review bookmark

On the configured Windows workstation, `npm run review` starts/resumes the explicitly selected demo preview at http://127.0.0.1:5188. It does not select the invoking checkout. `npm run dev` remains ordinary Vite development of the current checkout. `npm run preview` still serves the Vite production build; use `npm run review` for the stable bookmark.

The optional local tooling lives outside this repository at `%USERPROFILE%\Documents\ChatGPT\ApplyTrack\review`. Set `APPLYTRACK_REVIEW_HOME` to an alternative installation directory. A missing installation produces a setup error; this repository does not install a service or dependencies automatically. The tooling is workstation-local and is not deployed to production.

See that directory's `README.md` for setup, explicit activation, ownership, preserved demo storage, status/stop commands, recovery and verification. Build selects ready reviews; concurrent tasks must not automatically replace the selected change. Existing tabs require explicit reload after a selection change. API behavior is mocked and Supabase is disabled for review.
