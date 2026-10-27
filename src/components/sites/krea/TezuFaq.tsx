import { tezuAppHome } from "./app-links";
import "./tezu-faq.css";

export function TezuFaq() {
  return <section className="tezu-faq" aria-labelledby="tezu-faq-heading">
    <div className="tezu-faq-inner">
      <h2 id="tezu-faq-heading">Frequently asked questions</h2>
      <div className="tezu-faq-list">
        <details>
          <summary>How do I get started?<span className="tezu-faq-indicator" aria-hidden="true" /></summary>
          <p>Write a prompt or choose an example, then select Generate to open signup. Your prompt, reference and settings stay in place if you close signup or switch to login.</p>
        </details>
        <details>
          <summary>Can I use my own image as a reference?<span className="tezu-faq-indicator" aria-hidden="true" /></summary>
          <p>Yes. Use the image reference button beside the prompt to choose an image from your device. It stays attached while you open and close signup on that page.</p>
        </details>
        <details>
          <summary>How does the motion comparison work?<span className="tezu-faq-indicator" aria-hidden="true" /></summary>
          <p>On the Motion control page, drag the white divider with your mouse or finger to reveal each clip. With a keyboard, Tab to the comparison and use the arrow keys. The Play and Pause control operates both videos together.</p>
        </details>
        <details>
          <summary>Can I create an account or generate something now?<span className="tezu-faq-indicator" aria-hidden="true" /></summary>
          <p>This site is a frontend preview. Authentication and generation are not connected, so signup does not create an account and Generate does not start a generation job.</p>
        </details>
        <details>
          <summary>Where can I find pricing?<span className="tezu-faq-indicator" aria-hidden="true" /></summary>
          <p>Visit the <a href={`${tezuAppHome}pricing/`}>Pricing page</a> to explore the listed plans. Billing is not available in this frontend preview.</p>
        </details>
      </div>
    </div>
  </section>;
}
