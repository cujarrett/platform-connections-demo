export interface Case {
  kind: string
  title: string
  grug: string
  /** Absent on the closing card, which explains rather than calls. */
  call?: {
    from: string
    to: string
    gate: string
    url: string
    request: string
    /** Which pod's sidecar decides. The marker lands there, not mid-wire. */
    enforcedAt: "downstream" | "upstream"
    /** What the mesh should answer. Anything else means the demo is not wired up. */
    expect: number
    why: string
  }
  deep: string
  downstream: string
  upstream: string
  yaml: string
  /** The real files behind the snippet — the declaration, and what renders it. */
  sources: { label: string; url: string }[]
}

const WORKSPACES =
  "https://github.com/cujarrett/homelab-workspaces/blob/main/platform-connections-demo"
const HOMELAB = "https://github.com/cujarrett/homelab/blob/main"

const API_COMPOSITION = {
  label: "Api composition — renders the policy",
  url: `${HOMELAB}/platform/api/composition.yaml`,
}
const DESIGN_DOC = {
  label: "Platform Connections — design & build plan",
  url: `${HOMELAB}/docs/platform-connections.md`,
}

export const CASES: Case[] = [
  {
    kind: "on-platform → on-platform",
    title: "Not declared, so it is refused",
    grug:
      "The API was never told this caller may call it. The request reaches the API's pod and is turned away before the app ever sees it.",
    call: {
      from: "unauthorized-api",
      to: "upstream-api",
      gate: "upstream lets it in?",
      url: "/unauthorized/api/call",
      enforcedAt: "upstream",
      expect: 403,
      request: "GET upstream-api/api/v1/data",
      why: "<b>Denied.</b> Nothing was wrong with the caller — it simply was not on the list.",
    },
    deep: `<p>The callee declares who may call it, which renders one <code>AuthorizationPolicy</code> onto <b>its own</b> pod. The first ALLOW policy to select a workload makes that workload deny-by-default, so anything unnamed is refused.</p>
<p><b>Could a pod just claim to be someone else?</b> No. Identity is not a name in a header — every meshed pod holds an X.509 certificate issued to its service account, and <code>PeerAuthentication</code> in STRICT mode refuses any peer that cannot present one. The name is only checked after the certificate proves it.</p>`,
    downstream:
      "Declares nothing. Its request leaves normally — it is stopped at the far end, not this one.",
    upstream:
      "<code>provides.allowedCallers</code> → <code>AuthorizationPolicy</code> on its inbound sidecar. Returns 403.",
    yaml: `# upstream-api — the callee
provides:
  - name: data
    allowedCallers:
      - namespace: platform-connections-demo
        app: authorized-api
# unauthorized-api is absent, so it is denied`,
    sources: [
      { label: "upstream-api.yaml — the grant", url: `${WORKSPACES}/upstream-api.yaml` },
      API_COMPOSITION,
    ],
  },
  {
    kind: "on-platform → on-platform",
    title: "Declared, so it works",
    grug: "Same API, same image, same network as the last call. This caller is on the list.",
    call: {
      from: "authorized-api",
      to: "upstream-api",
      gate: "upstream lets it in?",
      url: "/authorized/api/call",
      enforcedAt: "upstream",
      expect: 200,
      request: "GET upstream-api/api/v1/data",
      why: "<b>Allowed.</b> One line of declaration is the entire difference from the previous call.",
    },
    deep: `<p>The same policy object as before — this caller's identity appears in its rule, so the request passes. Both callers run a byte-identical image; only the declaration differs, which is the whole point.</p>
<p>The grant is <b>coarse by default</b>: no methods or paths means the whole API. Narrow it only when one API has more than one trust boundary, such as <code>/public/</code> versus <code>/admin/</code>.</p>`,
    downstream:
      "Still declares nothing for this call. On-platform destinations need no declaration from the caller.",
    upstream:
      "Same <code>AuthorizationPolicy</code>. This caller's identity matches a rule, so it passes.",
    yaml: `# upstream-api — the callee
provides:
  - name: data
    allowedCallers:
      # ↓ the whole difference
      - namespace: platform-connections-demo
        app: authorized-api`,
    sources: [
      { label: "upstream-api.yaml — the grant", url: `${WORKSPACES}/upstream-api.yaml` },
      API_COMPOSITION,
    ],
  },
  {
    kind: "on-platform → off-platform",
    title: "An unregistered address is refused",
    grug: "The app tries to reach a site nobody registered. The request never leaves its own pod.",
    call: {
      from: "authorized-api",
      to: "example.com",
      gate: "may I leave?",
      url: "/authorized/api/leak",
      enforcedAt: "downstream",
      expect: 502,
      request: "GET https://example.com",
      why: "<b>Blocked at its own sidecar.</b> The packet never reaches the internet.",
    },
    deep: `<p>Off-platform is the mirror image of the first two calls. There is no pod on the far end to hold a policy, so the only place to decide is the caller's own outbound sidecar.</p>
<p>Its <code>Sidecar</code> runs in <code>REGISTRY_ONLY</code> mode: it may reach cluster services in its own namespace, the control plane, and the hosts it declared. Nothing else exists as far as it is concerned.</p>`,
    downstream:
      "<code>Sidecar</code> + <code>REGISTRY_ONLY</code> on its outbound side. <code>example.com</code> is not listed, so the call dies here.",
    upstream:
      "Nothing. It is a website on the internet — no sidecar, and it never learns the call was attempted.",
    yaml: `# authorized-api — the caller
consumes:
  - host: api.open-meteo.com
# example.com is absent, so it is unreachable`,
    sources: [
      { label: "authorized-api.yaml — what it declares", url: `${WORKSPACES}/authorized-api.yaml` },
      API_COMPOSITION,
    ],
  },
  {
    kind: "on-platform → off-platform",
    title: "A registered address works",
    grug: "Same app, same internet. This address was declared, so the call goes out.",
    call: {
      from: "authorized-api",
      to: "api.open-meteo.com",
      gate: "may I leave?",
      url: "/authorized/api/weather",
      enforcedAt: "downstream",
      expect: 200,
      request: "GET https://api.open-meteo.com/v1/forecast",
      why: "<b>Allowed.</b> Declaring the host is what makes it reachable.",
    },
    deep: `<p>Declaring the host renders a <code>ServiceEntry</code>, putting it in this pod's registry, and adds it to the <code>Sidecar</code> egress list. Both are needed: the entry makes the address <b>known</b>, the egress line makes it <b>permitted for this workload specifically</b>.</p>
<p>That second part matters. A <code>ServiceEntry</code> is registered namespace-wide, so without the per-workload egress line a neighbour in the same namespace would inherit the ability to reach it.</p>`,
    downstream:
      "<code>consumes.host</code> → a <code>ServiceEntry</code> plus an egress entry, both scoped to this pod.",
    upstream:
      "Still nothing. The site checks no identity — the mesh controls which workload may reach it, from this end.",
    yaml: `# authorized-api — the caller
consumes:
  - host: api.open-meteo.com
# declared, so this one is reachable`,
    sources: [
      { label: "authorized-api.yaml — what it declares", url: `${WORKSPACES}/authorized-api.yaml` },
      API_COMPOSITION,
    ],
  },
  {
    kind: "where this stops",
    title: "This answers which workload, not which person",
    grug:
      "Every call above was decided by which pod was calling. None of it knows anything about a user.",
    deep: `<p><b>What is settled:</b> a workload's identity is a certificate it cannot forge, and every call is refused unless something declared it. That holds whether or not a user is ever involved.</p>
<p><b>What is missing:</b> a signed-in person, and what they are allowed to do. An API open to a calling workload is open to <b>every</b> request that workload sends, no matter who triggered it.</p>
<p><b>How it attaches:</b> the same <code>AuthorizationPolicy</code> rule that already matches the workload gains a <code>when:</code> clause matching a claim in the user's token. One rule, two conditions, both must hold — it has to be the same rule, because two separate ALLOW policies are OR'd together and would <b>widen</b> access instead of narrowing it.</p>`,
    downstream:
      "Would carry the user's token onward. The mesh does not forward it across a hop by itself.",
    upstream: "Same policy object, one clause richer. Nothing already declared has to be redone.",
    yaml: `rules:
  - from:
      - source:
          principals: ["…/sa/authorized-api"]
    # ↑ which workload — enforced today
    when:
      - key: request.auth.claims[roles]
        values: ["collection.reader"]
    # ↑ which person — added later`,
    sources: [DESIGN_DOC],
  },
]
