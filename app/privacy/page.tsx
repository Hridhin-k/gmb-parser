import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy — RevuPilot",
};

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy" updated="Updated 27 October 2026"
      contents={[
        { id: "p1", label: "Two Google accounts" },
        { id: "p2", label: "What we store" },
        { id: "p3", label: "AI" },
        { id: "p4", label: "Who can see it" },
        { id: "p5", label: "How long it stays" },
        { id: "p6", label: "Your choices" },
      ]}
    >
      <p>
        RevuPilot is a Google review workspace operated by Explained Digital. This
        policy describes what the app stores, who can see it, and where it is
        sent — including reply drafts, profile summaries, and the per-review
        topic extraction described below.
      </p>

      <section id="p1">
        <h2>Two Google accounts</h2>
        <p className="mt-3">
          Signing in and connecting a Business Profile are separate.
        </p>
        <ul>
          <li>
            <strong>Sign-in.</strong> Continue with Google opens your RevuPilot
            workspace. We receive the Google account identity Supabase Auth
            returns for that login, including the email address and a user id.
          </li>
          <li>
            <strong>Business Profile connection.</strong> Settings → Connect
            Google asks for permission to manage the Business Profiles that
            account already owns or manages. We store that Google email and
            the OAuth tokens. Tokens are encrypted at rest. This connection is
            what lets RevuPilot list locations and reviews. A personal Gmail that
            does not manage those businesses will sync empty.
          </li>
        </ul>
      </section>

      <section id="p2">
        <h2>What we store</h2>
        <ul>
          <li>
            Workspace membership: who belongs, their role (owner, admin, or
            member), and which workspace is active.
          </li>
          <li>
            Invites: the email address and role an owner or admin enters.
            RevuPilot does not send that invite by email. The person sees the
            workspace the next time they sign in with that exact Google email.
          </li>
          <li>
            Synced Google data: location titles, addresses, store codes,
            reviews (reviewer display name, whether the reviewer is anonymous,
            star rating, comment, and timestamps), and any reply already
            published on Google.
          </li>
          <li>
            Work you do in RevuPilot: reply drafts, who approved them, publish
            attempts, failures, and the audit log of those actions.
          </li>
          <li>
            AI output: a stored draft of a suggested reply.
          </li>
        </ul>
        <p className="mt-3">
          Reviewer names and comments come from Google. Reviewers do not
          create an account in RevuPilot, and RevuPilot does not contact them except by
          publishing a reply you choose to send back through Google.
        </p>
      </section>

      <section id="p3">
        <h2>AI</h2>
        <p className="mt-3">
          RevuPilot uses the configured AI provider, OpenAI or Google, for reply
          drafts, settings previews, review topic extraction and insight
          summaries. The provider and model may differ by task.
        </p>
        <ul>
          <li>
            A reply draft sends that review’s text, star rating, and the
            business or location name, plus that organisation’s saved
            instructions. Another organisation’s instructions are not
            included.
          </li>
          <li>
            The draft stays inside RevuPilot. It is not on Google until a person
            publishes it. Owners and admins approve. Members can draft and,
            after approval, publish. A failed publish can be retried; that
            retry is not a new approval.
          </li>
          <li>
            The instruction to the model asks it to write in the business’s
            voice, without commentary about how the draft was made. A person
            on your team reads, edits, and approves every reply before it is
            published. AI can be wrong, generic, or off-tone.
          </li>
          <li>
            We do not use your reviews to train a model of our own. The text
            is processed by the configured provider’s API under that provider’s terms.
          </li>
        </ul>
      </section>

      <section id="p4">
        <h2>Who can see it</h2>
        <ul>
          <li>
            People in the same workspace see the same clients, locations,
            reviews, drafts, and connected Google accounts. A personal
            workspace is private until an owner or admin invites someone.
          </li>
          <li>
            Google receives the reply when you publish, and receives the
            review text when you generate a draft.
          </li>
          <li>
            Supabase hosts authentication and the database.
          </li>
          <li>
            We do not sell personal information, and we do not use reviews for
            advertising.
          </li>
        </ul>
      </section>

      <section id="p5">
        <h2>How long it stays</h2>
        <p className="mt-3">
          Synced reviews, drafts, and the audit log stay for as long
          as the workspace does. Disconnecting Google in Settings stops new
          syncs for that connection. Revoking RevuPilot in your Google Account
          settings stops the connection from refreshing. Deleting a draft in
          the app removes that reply from RevuPilot; it does not delete a reply
          already published on Google.
        </p>
      </section>

      <section id="p6">
        <h2>Your choices</h2>
        <ul>
          <li>Sign in only if you agree to this policy and the Terms.</li>
          <li>Connect only a Google account you are allowed to manage.</li>
          <li>Skip AI draft and write the reply yourself.</li>
          <li>Leave a draft unpublished.</li>
          <li>Disconnect Google, and sign out, from the app.</li>
        </ul>
        <p className="mt-3">
          To ask what a workspace holds, or to ask for it to be removed,
          email{" "}
          <a className="font-medium text-brand hover:underline" href="mailto:hridhin@explaineddigital.com">
            hridhin@explaineddigital.com
          </a>
          . If you were invited, the workspace owner can also see the same
          records.
        </p>
      </section>
    </LegalDocument>
  );
}
