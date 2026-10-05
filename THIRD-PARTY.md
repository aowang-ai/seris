# Third-party software and assets

Seris's project license applies to project-owned code and documentation.
Dependencies and fonts retain their own licenses. Seris brand terms are in
[the brand license](apps/desktop-ui/public/brand/LICENSE.md).

The desktop preparation script builds `licenses/THIRD-PARTY-NOTICES.txt` from
installed production JavaScript dependencies and the target's resolved Rust
crates. It copies their license and notice text, with package names, versions and
upstream links, into the application resources. Upstream notice files absent
from a published package are supplemented from the reviewed files under
`licenses/upstream/`. Packaging fails if an included dependency has no notice
text. Refresh supplements when changing the corresponding dependency version.

The bundled Node executable carries its complete Node and embedded-library
license file as `licenses/Node-LICENSE.txt`. The script finds the license beside
the build machine's Node installation. For a custom installation, set
`SERIS_NODE_LICENSE_PATH` to the full LICENSE from the exact Node distribution
being packaged. The script fails if that license cannot be found.

The project LICENSE, NOTICE, brand license and font OFL notice also travel with
the desktop bundle. These are resource files and do not add notices to the
application's screens. The front end retains its existing TradingView chart
attribution and `/licenses/lightweight-charts.txt`.

For MPL-2.0 Rust dependencies, the package version and upstream source URL in the
generated notices identify the unmodified source. Source archives are available
through crates.io.

## Design references

Early prototypes used Minara tool names and skill metadata as design references.
Bundled prompts and skill instructions were rewritten for Seris's current
interfaces. This is not a claim of a formal clean-room process or a Minara
service, endorsement or integration.

Synara and Cherry Studio informed UI and interaction decisions; they are
references, not bundled applications. Dependency licenses do not grant rights
to third-party market data, user-installed skills or generated documents.
