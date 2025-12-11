# Spidersan License

## Summary

Spidersan uses a dual-license model:

| Component | License | Cost |
|-----------|---------|------|
| **Core** (`/core`) | MIT License | Free forever |
| **Pro** (`/pro`) | Business Source License 1.1 | Paid for commercial use |

---

## Core License (MIT)

The following components are licensed under the MIT License:

- CLI commands: `init`, `register`, `list`, `merge-order`, `cleanup`
- SQLite storage adapter
- Basic branch registry
- Configuration file handling

```
MIT License

Copyright (c) 2024 Spidersan Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Pro License (Business Source License 1.1)

The following components are licensed under the Business Source License 1.1:

- Supabase/Postgres sync adapters
- Conflict prediction engine
- Team collaboration features
- GitHub Actions integration
- Web dashboard
- Priority support access

### License Terms

```
Business Source License 1.1

Licensor: Spidersan
Licensed Work: Spidersan Pro

The Licensed Work is provided under the terms of the Business Source License
("License").

Change Date: Four years from the release date of each version

Change License: MIT License

---

Grant of Rights:

The Licensor grants you a non-exclusive, worldwide, royalty-free, non-sublicensable,
non-transferable license to use, copy, modify, and redistribute the Licensed Work,
with the following restrictions:

1. PRODUCTION USE RESTRICTION

   You may NOT use the Licensed Work in a production environment if:
   
   a) Your organization has more than $1,000,000 USD in annual revenue; OR
   b) The Licensed Work will be used as part of a product or service that
      generates revenue of any amount; OR
   c) The Licensed Work will be resold, white-labeled, or redistributed as
      part of a commercial offering.

2. PERMITTED FREE USE

   You MAY use the Licensed Work for free in production if:
   
   a) You are an individual developer (personal projects); OR
   b) Your organization has less than $1,000,000 USD in annual revenue AND
      you are not reselling the software; OR
   c) You are using it for educational or non-commercial purposes.

3. PURCHASING A LICENSE

   If your use case is restricted under Section 1, you must purchase a
   commercial license.
   
   Contact: [INSERT CONTACT EMAIL]
   
   Commercial license pricing:
   - Small teams (2-10 users): $15/month per user
   - Enterprise (11+ users): Contact for pricing

4. CONVERSION TO MIT

   On the Change Date, or four years after the release of each version
   (whichever comes first), the Licensed Work converts to the MIT License.
   This means older versions eventually become fully open source.

---

DISCLAIMER:

THE LICENSED WORK IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED.
```

---

## Feature Breakdown: Free vs Pro

### Free (MIT License)

| Feature | Included |
|---------|----------|
| `spidersan init` | ✅ |
| `spidersan register` | ✅ |
| `spidersan list` | ✅ |
| `spidersan merge-order` | ✅ |
| `spidersan cleanup` | ✅ |
| Local SQLite storage | ✅ |
| Single developer use | ✅ |
| Community support (GitHub Issues) | ✅ |

### Pro (BSL License)

| Feature | Included |
|---------|----------|
| Everything in Free | ✅ |
| Supabase sync | ✅ |
| PostgreSQL sync | ✅ |
| Team collaboration | ✅ |
| `spidersan conflicts` (prediction) | ✅ |
| `spidersan dashboard` (web UI) | ✅ |
| GitHub Actions integration | ✅ |
| MCP server for Claude | ✅ |
| Priority email support | ✅ |

---

## FAQ

### Can I use the free version at work?

**Yes**, if your company has less than $1M annual revenue and you're not reselling it.

### What happens after 4 years?

Each version converts to MIT license after 4 years, making it fully open source.

### Can I contribute to the Pro features?

Yes! Contributors get a free Pro license. See CONTRIBUTING.md.

### Why not just make it all open source?

We believe in sustainable open source. The Core is always free. Pro features
fund continued development and support.

---

## Contact

- **General inquiries:** [INSERT EMAIL]
- **Commercial licensing:** [INSERT EMAIL]
- **Security issues:** [INSERT EMAIL]

---

*This license was last updated: December 2024*
