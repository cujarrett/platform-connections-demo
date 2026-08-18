/** A real file behind a snippet on the page. */
export interface Source {
  /** Shown in mono. The file the reader would open. */
  file: string
  /** What to look at once it opens. */
  note: string
  url: string
  /** Steers the link target, and the hover title. As a visible badge it competed with
   *  the filename for a line whose job is naming one file. */
  lines?: string
}

/** One file, or one rendered object. Never two of either in the same block. Stacked in
 *  a single box, a reader has to find the divider before knowing what they are reading. */
export interface Snippet {
  code: string
  sources: Source[]
  /** Whose pod this belongs to. Colours the block in that actor's hue, so a reader
   *  tracks ownership by sight instead of by counting rows across two columns. */
  actor?: "caller" | "callee"
}

export interface Case {
  /** Shown as a band above this card, once per group. The mesh and Entra runs are the
   *  same shape and different systems, and a per-card badge was not enough to say so. */
  section?: { label: string; blurb: string }
  kind: string
  title: string
  summary: string
  /** Absent on the closing card, which explains rather than calls. */
  call?: {
    from: string
    to: string
    gate: string
    url: string
    request: string
    /** Which pod's strip decides. The marker lands there, not mid-wire. */
    enforcedAt: "downstream" | "upstream"
    /** What does the deciding, so the strip is not labelled as the mesh when the
     *  mesh already said yes and application code is the thing refusing. */
    enforcedBy?: "mesh" | "app"
    /** What the mesh should answer. Anything else means the demo is not wired up. */
    expect: number
    /** Shown beside the status when the code alone would read as a broken demo. */
    codeNote?: string
    why: string
  }
  deep: string
  /** Why the callee column is empty. Only read when that pod renders nothing. */
  upstream?: string
  /** What the team writes, one block per file. */
  declared?: Snippet[]
  /** What the platform renders from it, one block per object. */
  rendered?: Snippet[]
  /** Inline SVG, drawn rather than described. Static markup, never response data. */
  diagram?: string
  /** Standalone reading, for a card with no snippet to sit under. */
  docs?: Source[]
}

const WORKSPACES_SHA = "6500b37ffbf600201f2e59666b6a42daa9737dae"
const WORKSPACES = `https://github.com/cujarrett/homelab-workspaces/blob/${WORKSPACES_SHA}/platform-connections-demo`
const HOMELAB = "https://github.com/cujarrett/homelab/blob/main"

// Pinned to a commit, not to main. A line range on a moving branch drifts silently and
// eventually points at the wrong block; a permalink keeps pointing at the code that
// actually rendered the YAML above. Repin when the composition changes materially.
const COMPOSITION_SHA = "d928adcaf92a36caef431fa8ae2c6e1bdea4f878"
const COMPOSITION = `https://github.com/cujarrett/homelab/blob/${COMPOSITION_SHA}/platform/api/composition.yaml`

// GitHub wants the hyphen in the anchor; the badge shows an en dash.
function composition(note: string, from: number, to: number): Source {
  return {
    file: "platform/api/composition.yaml",
    note,
    lines: `L${from}–L${to}`,
    url: `${COMPOSITION}#L${from}-L${to}`,
  }
}

function workspace(file: string, note: string, from: number, to: number): Source {
  return {
    file,
    note,
    lines: `L${from}–L${to}`,
    url: `${WORKSPACES}/${file}#L${from}-L${to}`,
  }
}

const DESIGN_DOC: Source = {
  file: "docs/platform-connections.md",
  note: "the design and build plan behind all of this",
  url: `${HOMELAB}/docs/platform-connections.md`,
}
const NOTHING_NOVEL: Source = {
  file: "docs/nothing-novel.md",
  note: "every mechanism above, traced to the spec or vendor doc it came from",
  url: `${HOMELAB}/docs/nothing-novel.md`,
}
const CROSSPLANE_ADOPTERS: Source = {
  file: "crossplane/ADOPTERS.md",
  note: "Nike, SAP, Autodesk, Grafana Labs and Nokia, on the control plane this runs on",
  url: "https://github.com/crossplane/crossplane/blob/main/ADOPTERS.md",
}
const ISTIO_CASE_STUDIES: Source = {
  file: "istio.io/case-studies",
  note: "T-Mobile, eBay, Salesforce and Airbnb, on the mesh enforcing these calls",
  url: "https://istio.io/latest/about/case-studies/",
}

export const CASES: Case[] = [
  {
    section: {
      label: "Service mesh",
      blurb:
        "Enforced by a proxy beside every pod, against certificates this cluster issues. Decides whether a call is carried at all.",
    },
    kind: "service mesh · on-platform → on-platform",
    title: "Declared, so it works",
    summary:
      "Two declarations, one on each side: the caller's way out, the callee's guest list. The call works only because both are there.",
    call: {
      from: "authorized-api",
      to: "upstream-api",
      gate: "callee lets it in?",
      url: "/authorized/api/call",
      enforcedAt: "upstream",
      expect: 200,
      request: "GET upstream-api/api/v1/data",
      why: "<b>Allowed.</b> The caller's identity is named in the policy, so it passes.",
    },
    deep: `<p>Two yeses, one from each pod. Sharing a namespace is neither.</p>
<p><b>Neither team wrote a service mesh policy.</b> One declared what it calls, the other who may call it. Platform engineering is the difference between understanding a mesh and shipping without needing to.</p>`,
    declared: [
      {
        code: `consumes:
  # ↓ lets the call out
  - namespace: platform-connections-demo
    app: upstream-api`,
        sources: [workspace("authorized-api.yaml", "the caller's way out", 25, 27)],
        actor: "caller",
      },
      {
        code: `provides:
  - name: data
    allowedCallers:
      # ↓ lets the call in
      - namespace: platform-connections-demo
        app: authorized-api`,
        sources: [workspace("upstream-api.yaml", "the callee's guest list", 24, 27)],
        actor: "callee",
      },
    ],
    rendered: [
      {
        code: `# the way out
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: authorized-api
spec:
  outboundTrafficPolicy:
    mode: REGISTRY_ONLY
  egress:
    - hosts:
        - "istio-system/*"   # istiod, where the sidecar gets its config and certs
        # ↓ the app it declared. every other line here was declared too,
        #   and the cards below account for them. no wildcard anywhere
        - "platform-connections-demo/upstream-api.platform-connections-demo.svc.cluster.local"
        # ...one entry per declared destination`,
        sources: [composition("the Sidecar egress list", 1011, 1054)],
        actor: "caller",
      },
      {
        code: `# the way in
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: upstream-api
spec:
  selector:
    matchLabels: { app.kubernetes.io/instance: upstream-api }
  action: ALLOW
  rules:
    # metrics, on its own port. no principal, because the scraper has none
    - to:
        - operation:
            ports: ["9090"]
    # provides: data
    - from:
        - source:
            principals:
              # ↓ the identity the caller proved with its certificate
              - "cluster.local/ns/platform-connections-demo/sa/authorized-api"
              # no method or path limits, so the grant is the whole API`,
        sources: [composition("the AuthorizationPolicy template", 961, 1010)],
        actor: "callee",
      },
    ],
  },
  {
    kind: "service mesh · on-platform → on-platform",
    title: "Not declared, so it is refused",
    summary:
      "Same image, same declared way out. It is missing from the guest list, so it is turned away before the app ever sees it.",
    call: {
      from: "unauthorized-api",
      to: "upstream-api",
      gate: "callee lets it in?",
      url: "/unauthorized/api/call",
      enforcedAt: "upstream",
      expect: 403,
      request: "GET upstream-api/api/v1/data",
      why: "<b>Denied.</b> Nothing was wrong with the caller. It simply was not on the list.",
    },
    deep: `<p>upstream-api names one caller: authorized-api. Only the guest list differs.</p>
<p><b>Could a pod claim to be someone else?</b> No - identity is a certificate, not a header. STRICT mTLS refuses any peer without one, and the name is checked only after the certificate proves it.</p>`,
    declared: [
      {
        code: `consumes:
  # ↓ the same line the last caller wrote, so it left its own pod fine
  - namespace: platform-connections-demo
    app: upstream-api`,
        sources: [
          workspace("unauthorized-api.yaml", "the caller, same image, same way out", 15, 16),
        ],
        actor: "caller",
      },
      {
        code: `provides:
  - name: data
    allowedCallers:
      - namespace: platform-connections-demo
        app: authorized-api
# unauthorized-api is absent, so it is denied`,
        sources: [workspace("upstream-api.yaml", "the guest list it is missing from", 24, 27)],
        actor: "callee",
      },
    ],
    rendered: [
      {
        code: `# no certificate, no conversation
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: upstream-api
spec:
  selector:
    matchLabels: { app.kubernetes.io/instance: upstream-api }
  mtls:
    mode: STRICT
  portLevelMtls:
    # the one hole, and it is deliberate: Prometheus is not in the mesh
    # and has no certificate to present. App traffic is unaffected.
    "9090":
      mode: PERMISSIVE`,
        sources: [composition("the PeerAuthentication template", 937, 960)],
        actor: "callee",
      },
      {
        code: `# the guest list
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: upstream-api
spec:
  selector:
    matchLabels: { app.kubernetes.io/instance: upstream-api }
  action: ALLOW
  rules:
    # rules are ORed, so this one is a second way in - metrics only
    - to:
        - operation:
            ports: ["9090"]
    # provides: data
    - from:
        - source:
            principals:
              - "cluster.local/ns/platform-connections-demo/sa/authorized-api"
# unauthorized-api appears in no rule that carries the app port, so it is refused`,
        sources: [composition("the AuthorizationPolicy template", 961, 1010)],
        actor: "callee",
      },
    ],
  },
  {
    kind: "service mesh · on-platform → off-platform",
    title: "A registered address works",
    summary:
      "The destination is on the internet now, outside the cluster and outside the mesh. The caller declared that one address, so the call goes out.",
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
    deep: `<p>One declared hostname renders both: a <code>ServiceEntry</code> making the address known, a <code>Sidecar</code> line letting this pod reach it. Known is not permitted.</p>`,
    upstream:
      "Nothing. The site checks no identity, so the mesh alone controls which workload may reach it.",
    declared: [
      {
        code: `consumes:
  - host: api.open-meteo.com
# declared, so this one is reachable`,
        sources: [workspace("authorized-api.yaml", "the declared host", 25, 26)],
        actor: "caller",
      },
    ],
    rendered: [
      {
        code: `# makes the address known
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: authorized-api-api-open-meteo-com
spec:
  hosts:
    - "api.open-meteo.com"
  location: MESH_EXTERNAL
  resolution: DNS
  exportTo: ["."]        # this namespace only
  ports:
    - number: 443
      name: tls
      protocol: TLS      # the app's own TLS passes straight through`,
        sources: [composition("the ServiceEntry per declared host", 1079, 1104)],
        actor: "caller",
      },
      {
        code: `# makes it this pod's to reach
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: authorized-api
spec:
  egress:
    - hosts:
        - "istio-system/*"   # istiod, where the sidecar gets its config and certs
        - "./api.open-meteo.com"   # known is not enough, this line permits it`,
        sources: [composition("the Sidecar egress list", 1011, 1054)],
        actor: "caller",
      },
    ],
  },
  {
    kind: "service mesh · on-platform → off-platform",
    title: "An unregistered address is refused",
    summary:
      "Same app, same internet, one call later. This address was never declared, so the request does not even leave the pod.",
    call: {
      from: "authorized-api",
      to: "example.com",
      gate: "may I leave?",
      url: "/authorized/api/leak",
      enforcedAt: "downstream",
      expect: 502,
      request: "GET https://example.com",
      codeNote: "its own sidecar refused the connection, example.com was never contacted",
      why: "<b>Blocked on the way out.</b> The packet never reaches the internet.",
    },
    deep: `<p>No pod on the far end to hold a policy, so the only place to decide is on the way out.</p>
<p>Its <code>Sidecar</code> runs <code>REGISTRY_ONLY</code> - the control plane, its namespace, and what it declared. Nothing else exists. No team asked for that default, and none can forget it.</p>`,
    upstream:
      "Nothing. It is a website on the internet, outside the mesh, and it never learns the call was attempted.",
    declared: [
      {
        code: `consumes:
  - host: api.open-meteo.com
# example.com is absent, so it is unreachable`,
        sources: [
          workspace(
            "authorized-api.yaml",
            "every host it declared, and example.com is not one",
            25,
            27,
          ),
        ],
        actor: "caller",
      },
    ],
    rendered: [
      {
        code: `apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: authorized-api
spec:
  workloadSelector:
    labels: { app.kubernetes.io/instance: authorized-api }
  outboundTrafficPolicy:
    mode: REGISTRY_ONLY   # unknown address means no address
  egress:
    - hosts:
        - "istio-system/*"   # istiod, where the sidecar gets its config and certs
        - "./api.open-meteo.com"    # the one host it declared
# example.com is on no list, so there is nowhere to send it`,
        sources: [composition("REGISTRY_ONLY and the Sidecar egress list", 1011, 1054)],
        actor: "caller",
      },
    ],
  },
  {
    kind: "service mesh · on-platform → off-platform",
    title: "A bound resource declares itself",
    summary:
      "The app writes an item to a cloud database, reads it back, then deletes it. It never declared the address. Asking for the table was the declaration.",
    call: {
      from: "authorized-api",
      to: "dynamodb.us-east-1.amazonaws.com",
      gate: "may I leave?",
      url: "/authorized/api/table",
      enforcedAt: "downstream",
      expect: 200,
      request: "PutItem → GetItem → DeleteItem",
      why: "<b>Allowed.</b> The table reference is what opened the path to it.",
    },
    deep: `<p>Off-platform hosts normally go in <code>consumes</code>. Not this one: asking for a table identifies the endpoint, so the platform registers it.</p>
<p><b>There is a hidden call first.</b> Before any table call, a sidecar trades this pod's identity for temporary AWS keys at <code>sts.us-east-1.amazonaws.com</code> - an endpoint nobody declared, and unregistered means blackholed. Miss it and the pod starts fine, then fails every call.</p>
<p>That trade is not the mesh certificate. The certificate is X.509 and never leaves the proxy; what goes to AWS is a <b>JWT-SVID</b> for the same identity, and the role's trust policy pins its <code>sub</code> to this exact service account. Two shapes of the one identity, each for the system that can read it.</p>
<p>A bucket, a cache, a queue - same thing. <b><code>consumes</code> is for what nothing else states.</b></p>`,
    upstream: "Nothing. The database is outside the mesh too.",
    declared: [
      {
        code: `nosqlRef:
  name: records
# no consumes entry for the endpoint, the ref is the declaration`,
        sources: [
          workspace("authorized-api.yaml", "the ref, which is the whole declaration", 18, 19),
          workspace("records.yaml", "the table it points at", 1, 8),
        ],
        actor: "caller",
      },
    ],
    rendered: [
      {
        code: `# nothing below was written by the app
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: authorized-api
spec:
  egress:
    - hosts:
        - "istio-system/*"
        # ↓ where the certificate is traded for credentials
        - "./sts.us-east-1.amazonaws.com"
        # ↓ every table in the region shares this one host
        - "./dynamodb.us-east-1.amazonaws.com"
        # ...and one more from entra, on the next card`,
        sources: [composition("the Sidecar egress list", 1011, 1054)],
        actor: "caller",
      },
      {
        code: `apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: authorized-api-dynamodb-us-east-1-amazonaws-com
spec:
  hosts:
    - "dynamodb.us-east-1.amazonaws.com"
  location: MESH_EXTERNAL
  resolution: DNS
  exportTo: ["."]
  ports:
    - number: 443
      name: tls
      protocol: TLS`,
        sources: [composition("the ServiceEntry per derived endpoint", 1055, 1078)],
        actor: "caller",
      },
    ],
  },
  {
    section: {
      label: "Entra",
      blurb:
        "Enforced by application code, against an identity provider outside the cluster, and no team holds a secret. Runs only after every mesh gate has already said yes.",
    },
    kind: "entra · on-platform → on-platform",
    title: "A second gate, answering to someone else",
    summary:
      "The same caller, the same callee, one route further on. The mesh lets it through exactly as before, and then the app asks a question the mesh never asked: was this identity granted the role?",
    call: {
      from: "authorized-api",
      to: "upstream-api",
      gate: "granted the role?",
      url: "/authorized/api/entra",
      enforcedAt: "upstream",
      enforcedBy: "app",
      expect: 200,
      request: "GET upstream-api/api/v1/protected",
      why: "<b>Allowed.</b> Every mesh gate passed, and the token carried Data.Read.",
    },
    deep: `<p>Nothing replaces the mesh. All four checkpoints pass first, then a token is read. This gate can refuse what the mesh allowed, never permit what it refused.</p>
<p><b>Two tokens, neither a password.</b> The pod's <b>SVID</b> says who it is - <code>sub</code> its SPIFFE ID, <code>aud</code> <code>api://AzureADTokenExchange</code>. Entra accepts it because a <b>federated credential</b> names those exact strings, matched literally. Back comes an <b>access token</b>: <code>azp</code> the caller, <code>aud</code> this API, <code>roles</code> what it holds. Only <code>roles</code> decides.</p>
<p><b>Why a federated credential and not a client secret.</b> The usual way is a password on the app registration, and it has to live somewhere - a vault, a Secret, a pipeline variable - rotated on a calendar and copied into every new environment. This replaces that string with a statement about who may ask. Nothing is issued to store, so nothing can leak, and revoking access is deleting an object rather than chasing copies.</p>
<p>What the app presents instead is a file. A sidecar the platform adds keeps a fresh SVID at <code>/entra-identity/token</code>, and the app posts it as a <code>client_assertion</code>. It lasts minutes, is minted for that one audience, and the app holds no credential of its own.</p>
<p>The scope <code>&lt;this API&gt;/.default</code> means "every role I already hold". It cannot name one it was not granted - that needs a user to consent, and there is none. The platform builds that scope from the <code>consumes</code> line on the mesh card, so one declaration opened the network path and named the API to ask against.</p>
<p>The panel shows what the caller proved and what the callee received. The tokens never appear - each is a live credential, and this page is public.</p>`,
    declared: [
      {
        code: `entra:
  enabled: true
# an identity, and nothing else. it grants nothing`,
        sources: [workspace("authorized-api.yaml", "the caller asks only for an identity", 12, 13)],
        actor: "caller",
      },
      {
        code: `consumes:
  - namespace: platform-connections-demo
    app: upstream-api
# the mesh card's line again. it also names which API to ask a token for`,
        sources: [
          workspace("authorized-api.yaml", "the line the Entra scope is built from", 25, 27),
        ],
        actor: "caller",
      },
      {
        code: `entra:
  enabled: true
  roles:
    - name: Data.Read
      allowedCallers:
        - namespace: platform-connections-demo
          app: authorized-api`,
        sources: [
          workspace("upstream-api.yaml", "the callee declares the role, and who holds it", 13, 18),
        ],
        actor: "callee",
      },
    ],
    rendered: [
      {
        code: `# the caller's own identity in Entra. no password field anywhere
apiVersion: applications.azuread.upbound.io/v1beta2
kind: Application
metadata:
  name: platform-connections-demo-authorized-api-entra
spec:
  forProvider:
    displayName: platform-platform-connections-demo-authorized-api
    api:
      # v1 tokens are issued by sts.windows.net and fail issuer checks
      requestedAccessTokenVersion: 2`,
        sources: [composition("the Application template", 667, 697)],
        actor: "caller",
      },
      {
        code: `# why Entra believes the pod at all, and the reason there is no secret.
# all three are matched literally - no wildcards, no prefixes
apiVersion: applications.azuread.upbound.io/v1beta1
kind: FederatedIdentityCredential
spec:
  forProvider:
    issuer: https://oidc.mattjarrett.dev
    subject: spiffe://homelab.local/ns/platform-connections-demo/sa/authorized-api
    audiences:
      - api://AzureADTokenExchange`,
        sources: [composition("the FederatedIdentityCredential template", 715, 734)],
        actor: "caller",
      },
      {
        code: `# what landed in the caller's pod. it reads these, and writes none of them
env:
  - name: AZURE_CLIENT_ID          # who it acts as
  - name: AZURE_TENANT_ID
  - name: AZURE_FEDERATED_TOKEN_FILE
    value: /entra-identity/token   # the SVID, kept fresh by a sidecar
  # ↓ one per app in consumes. the scope to ask a token for
  - name: ENTRA_SCOPE_UPSTREAM_API
    value: api://<tenant>/platform-platform-connections-demo-upstream-api/.default
---
# and the way out to Entra, which no team declared
kind: Sidecar
spec:
  egress:
    - hosts:
        - "./login.microsoftonline.com"`,
        sources: [
          composition("the Entra env injection", 380, 398),
          composition("login.microsoftonline.com, derived from entra.enabled", 128, 133),
        ],
        actor: "caller",
      },
      {
        code: `# the role this API offers
apiVersion: applications.azuread.upbound.io/v1beta1
kind: AppRole
metadata:
  name: platform-connections-demo-upstream-api-entra-role-data-read
spec:
  forProvider:
    value: Data.Read
    # not User - there is no person behind this call
    allowedMemberTypes: ["Application"]`,
        sources: [composition("the AppRole template", 746, 768)],
        actor: "callee",
      },
      {
        code: `# the grant itself, one per allowed caller
apiVersion: app.azuread.upbound.io/v1beta1
kind: RoleAssignment
metadata:
  name: platform-connections-demo-upstream-api-entra-grant-data-read-platform-connections-demo-authorized-api
spec:
  forProvider:
    principalObjectIdRef:
      name: platform-connections-demo-authorized-api-entra
    resourceObjectIdRef:
      name: platform-connections-demo-upstream-api-entra`,
        sources: [composition("the RoleAssignment template", 769, 795)],
        actor: "callee",
      },
    ],
  },
  {
    kind: "entra · on-platform → on-platform",
    title: "The same caller, refused one route later",
    summary:
      "This is the caller you just watched succeed. Same identity, same certificate, same guest list, one route further on. It is turned away by something the mesh had no part in.",
    call: {
      from: "authorized-api",
      to: "upstream-api",
      gate: "granted the role?",
      url: "/authorized/api/entra-admin",
      enforcedAt: "upstream",
      enforcedBy: "app",
      expect: 403,
      codeNote: "refused by the app, not the proxy",
      request: "GET upstream-api/api/v1/admin",
      why: "<b>Denied.</b> Allowed in, and still not allowed to do this.",
    },
    deep: `<p>Nothing changed about the caller - same certificate, same gates, same token, <code>roles</code> still holding <code>Data.Read</code>. This route wants a role that is not in the list, and no signed token can be talked into containing it.</p>
<p><b>Being let in is not being allowed to do everything.</b> The mesh answers once, at the door, for the whole workload. This answers per route.</p>
<p><b>Two 403s that look identical and are not.</b> The earlier came from a proxy reading a certificate, this from app code reading a claim - so the response says which gate answered.</p>
<p><b>Granting it is one line, and so is taking it back.</b> Adding this caller under <code>Data.Admin</code> renders one more <code>RoleAssignment</code>; deleting the line deletes the object, and the next token comes back without the role. Nothing to rotate, and no secret in anyone's hands to go and collect.</p>`,
    declared: [
      {
        code: `entra:
  enabled: true
# unchanged. the caller asks for nothing route-specific`,
        sources: [workspace("authorized-api.yaml", "the same two lines as the card above", 12, 13)],
        actor: "caller",
      },
      {
        code: `roles:
  - name: Data.Read
    allowedCallers:
      - namespace: platform-connections-demo
        app: authorized-api
  # offered, and held by nobody
  - name: Data.Admin
    allowedCallers: []`,
        sources: [workspace("upstream-api.yaml", "two roles, one grant", 13, 22)],
        actor: "callee",
      },
    ],
    rendered: [
      {
        code: `# both roles exist on the registration
apiVersion: applications.azuread.upbound.io/v1beta1
kind: AppRole
spec:
  forProvider:
    value: Data.Admin
    allowedMemberTypes: ["Application"]`,
        sources: [composition("one AppRole per declared role", 746, 768)],
        actor: "callee",
      },
      {
        code: `# one RoleAssignment, for Data.Read only.
# there is no object granting Data.Admin - that absence is the refusal
apiVersion: app.azuread.upbound.io/v1beta1
kind: RoleAssignment
spec:
  forProvider:
    principalObjectIdRef:
      name: platform-connections-demo-authorized-api-entra`,
        sources: [composition("one grant per allowed caller, and no more", 769, 795)],
        actor: "callee",
      },
    ],
  },
  {
    kind: "",
    title: "",
    summary:
      "",
    deep: "",
    diagram: `<svg viewBox="0 0 1000 392" role="img" aria-label="One SPIRE identity, read three ways: as a certificate by the mesh, and as a token by AWS STS and Microsoft Entra.">
  <defs>
    <marker id="pc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0 0 L8 4 L0 8 z" fill="currentColor" fill-opacity="0.55"/>
    </marker>
  </defs>
  <rect x="310" y="6" width="380" height="56" rx="8" fill="#1a1d27" stroke="#6366f1" stroke-opacity="0.7"/>
  <text x="500" y="30" class="d-t">SPIRE</text>
  <text x="500" y="49" class="d-s">issues one identity per workload</text>
  <text x="500" y="84" class="d-id">spiffe://homelab.local/ns/&lt;namespace&gt;/sa/&lt;app&gt;</text>
  <line x1="500" y1="92" x2="500" y2="116" stroke="#2e3347"/>
  <line x1="170" y1="116" x2="830" y2="116" stroke="#2e3347"/>
  <line x1="170" y1="116" x2="170" y2="132" stroke="#2e3347"/>
  <rect x="30" y="132" width="280" height="56" rx="8" fill="#1a1d27" stroke="#03a9f4" stroke-opacity="0.55"/>
  <text x="170" y="156" class="d-t">X.509 SVID</text>
  <text x="170" y="175" class="d-s">presented on every connection</text>
  <line x1="170" y1="188" x2="170" y2="200" stroke="#03a9f4" stroke-opacity="0.5" marker-end="url(#pc-arrow)"/>
  <rect x="30" y="208" width="280" height="52" rx="8" fill="#1a1d27" stroke="#03a9f4" stroke-opacity="0.55"/>
  <text x="170" y="230" class="d-t">Envoy sidecar</text>
  <text x="170" y="248" class="d-s">checks the cluster CA</text>
  <line x1="170" y1="260" x2="170" y2="272" stroke="#03a9f4" stroke-opacity="0.5" marker-end="url(#pc-arrow)"/>
  <rect x="30" y="280" width="280" height="52" rx="8" fill="#1a1d27" stroke="#03a9f4" stroke-opacity="0.55"/>
  <text x="170" y="302" class="d-t">mTLS on every call</text>
  <text x="170" y="320" class="d-s">AuthorizationPolicy decides</text>
  <line x1="170" y1="332" x2="170" y2="344" stroke="#03a9f4" stroke-opacity="0.5" marker-end="url(#pc-arrow)"/>
  <text x="170" y="362" class="d-d" fill="#03a9f4">pod to pod</text>
  <line x1="500" y1="116" x2="500" y2="132" stroke="#2e3347"/>
  <rect x="360" y="132" width="280" height="56" rx="8" fill="#1a1d27" stroke="#ff4081" stroke-opacity="0.55"/>
  <text x="500" y="156" class="d-t">JWT-SVID</text>
  <text x="500" y="175" class="d-s">aud: sts.amazonaws.com</text>
  <line x1="500" y1="188" x2="500" y2="200" stroke="#ff4081" stroke-opacity="0.5" marker-end="url(#pc-arrow)"/>
  <rect x="360" y="208" width="280" height="52" rx="8" fill="#1a1d27" stroke="#ff4081" stroke-opacity="0.55"/>
  <text x="500" y="230" class="d-t">AWS STS</text>
  <text x="500" y="248" class="d-s">AssumeRoleWithWebIdentity (AWS SDK)</text>
  <line x1="500" y1="260" x2="500" y2="272" stroke="#ff4081" stroke-opacity="0.5" marker-end="url(#pc-arrow)"/>
  <rect x="360" y="280" width="280" height="52" rx="8" fill="#1a1d27" stroke="#ff4081" stroke-opacity="0.55"/>
  <text x="500" y="302" class="d-t">temporary keys</text>
  <text x="500" y="320" class="d-s">IAM policy decides</text>
  <line x1="500" y1="332" x2="500" y2="344" stroke="#ff4081" stroke-opacity="0.5" marker-end="url(#pc-arrow)"/>
  <text x="500" y="362" class="d-d" fill="#ff4081">DynamoDB</text>
  <line x1="830" y1="116" x2="830" y2="132" stroke="#2e3347"/>
  <rect x="690" y="132" width="280" height="56" rx="8" fill="#1a1d27" stroke="#a5b4fc" stroke-opacity="0.55"/>
  <text x="830" y="156" class="d-t">JWT-SVID</text>
  <text x="830" y="175" class="d-s">aud: api://AzureADTokenExchange</text>
  <line x1="830" y1="188" x2="830" y2="200" stroke="#a5b4fc" stroke-opacity="0.5" marker-end="url(#pc-arrow)"/>
  <rect x="690" y="208" width="280" height="52" rx="8" fill="#1a1d27" stroke="#a5b4fc" stroke-opacity="0.55"/>
  <text x="830" y="230" class="d-t">Microsoft Entra</text>
  <text x="830" y="248" class="d-s">client_assertion (MSAL)</text>
  <line x1="830" y1="260" x2="830" y2="272" stroke="#a5b4fc" stroke-opacity="0.5" marker-end="url(#pc-arrow)"/>
  <rect x="690" y="280" width="280" height="52" rx="8" fill="#1a1d27" stroke="#a5b4fc" stroke-opacity="0.55"/>
  <text x="830" y="302" class="d-t">access token</text>
  <text x="830" y="320" class="d-s">roles decides</text>
  <line x1="830" y1="332" x2="830" y2="344" stroke="#a5b4fc" stroke-opacity="0.5" marker-end="url(#pc-arrow)"/>
  <text x="830" y="362" class="d-d" fill="#a5b4fc">upstream-api</text>
</svg>`,
    docs: [NOTHING_NOVEL],
  },
]
