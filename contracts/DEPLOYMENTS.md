# JANUS contract deployments

The legacy deployment remains the fallback for existing splits and payer links.
It has not been modified.

| Version | Address | Purpose |
| --- | --- | --- |
| JanusSplit (legacy) | `0x1c3F1382057F99b5dAd89855B919bB322792C66E` | Existing splits and current app flow |
| JanusSplitV2 | `0xE9B9C0e09819857D8aa32b1dD749B26F58E43eD1` | New splits after V2 routing is enabled |

V2 deployment transaction:

`0x9accba72959c9b1b6b8d0a9c5d9a9b6ccbf6031dc8ec7e1626312f2675416076`

The app must route each split to the contract that created it before V2 is
made the default. Until that integration is complete, the app intentionally
continues using the legacy address.
