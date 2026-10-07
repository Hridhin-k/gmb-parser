import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Terms of Service — GRM",
};

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Service" updated="Updated 1 October 2026">
      <p>
        These terms cover use of GRM, the Google review workspace operated by
        Explained Digital. By continuing with Google you agree to them and to
        the Privacy Policy.
      </p>

      <section>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif" }}>
          What GRM is
        </h2>
        <p className="mt-3">
          GRM lets a team read Google reviews for businesses they already
          manage, draft a reply, approve it, and publish that reply back to
          Google. The first sign-in creates a workspace for that login.
          Other people do not see it unless an owner or admin invites them.
        </p>
      </section>

      <section>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif" }}>
          Who may connect Google
        </h2>
        <ul>
          <li>
            Sign-in only identifies you. It does not grant access to Business
            Profiles.
          </li>
          <li>
            Connect Google on Settings only with an account that is an owner,
            manager, or admin of the businesses you intend to manage.
          </li>
          <li>
            You must not connect an account, or publish a reply, for a
            business you are not allowed to represent.
          </li>
          <li>
            Google’s own terms apply to your Google account and to Business
            Profile. If Google revokes access, sync and publish stop.
          </li>
        </ul>
      </section>

      <section>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif" }}>
          Workspaces and roles
        </h2>
        <ul>
          <li>
            An invite is accepted when that person next signs in with the
            same Google email. No invitation email is sent. Once accepted,
            they see that workspace’s clients, locations, reviews, drafts, and
            connected Google accounts.
          </li>
          <li>
            Anyone in the workspace may write a reply or ask for an AI draft.
          </li>
          <li>
            Only an owner or admin may approve a draft. After approval, a
            member may publish it to Google.
          </li>
          <li>
            You are responsible for who you invite. Remove access by asking
            the operator if you need someone taken off a workspace.
          </li>
        </ul>
      </section>

      <section>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif" }}>
          AI drafts are not the published reply
        </h2>
        <p className="mt-3">
          When you choose AI draft, or generate a profile insight, GRM sends
          the relevant review text to Google Gemini and stores the result.
          That result is a suggestion inside GRM. Profile insights may include
          branding notes, staff comments from reviews, and feature ideas.
          They are not sent to Google until a person acts on them.
        </p>
        <ul>
          <li>
            A person must read it before it is approved or published. Gemini
            can miss the point of a review, invent a detail, or use the wrong
            tone.
          </li>
          <li>
            Publishing sends the text to Google as the business’s reply. GRM
            does not label that public reply as machine-written. The business
            is the speaker.
          </li>
          <li>
            You may ignore the draft and write your own reply. Nothing is
            published until someone in the workspace publishes an approved
            reply.
          </li>
          <li>
            Do not use GRM to generate replies you are unwilling to stand
            behind, or to reply to reviews in a way that breaks the law or
            Google’s policies.
          </li>
        </ul>
      </section>

      <section>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif" }}>
          Acceptable use
        </h2>
        <ul>
          <li>Use GRM for businesses you are authorised to manage.</li>
          <li>
            Do not attempt to read another workspace, bypass approval, or pull
            data the connected Google account is not allowed to see.
          </li>
          <li>
            Do not upload secrets into a reply draft that you would not want
            stored with the review.
          </li>
        </ul>
      </section>

      <section>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif" }}>
          The service itself
        </h2>
        <p className="mt-3">
          GRM depends on Google and on the database that holds the workspace.
          Sync, AI, and publish can fail, pause, or return a partial result.
          A published reply can be rejected by Google. We do not promise that
          every review will sync, or that an AI draft will be fit to send.
        </p>
        <p className="mt-3">
          To the extent the law allows, Explained Digital is not liable for
          a reply you publish, for a review Google does not return, or for
          loss that follows from relying on an unreviewed draft. Nothing here
          limits liability that cannot legally be limited.
        </p>
      </section>

      <section>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif" }}>
          Contact
        </h2>
        <p className="mt-3">
          Questions about these terms:{" "}
          <a className="font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink" href="mailto:hridhin@explaineddigital.com">
            hridhin@explaineddigital.com
          </a>
          .
        </p>
      </section>
    </LegalDocument>
  );
}
