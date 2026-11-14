# Security policy

## Reporting a vulnerability

Please report suspected security issues privately to the project maintainers. Include the affected route or feature, a brief impact description, and steps to reproduce. Do not include real customer documents, passwords, access tokens, or other personal data. The repository does not currently publish a dedicated security contact; add a monitored security email or GitHub private vulnerability reporting destination before public launch.

Please allow maintainers time to investigate and prepare a fix before public disclosure. This project has not undergone a penetration test or independent security assessment and does not claim a compliance certification.

## Security status

The current application still uses its legacy SQLite and in-memory session implementation. The Supabase migration under `supabase/migrations` is an architecture scaffold and is not active until the API is migrated, the migration is applied to a Supabase project, and the tenant-isolation policies are tested there. Do not use this repository's current authentication or upload flow for sensitive production documents.

## Deployment safeguards

- Keep every Supabase secret key and mail provider credential on the server; never add them to frontend build variables.
- Use HTTPS in every deployed environment and configure trusted origins explicitly.
- Keep the `cleared-private` bucket private. Give signed download links a short expiry and authorize each request before issuing one.
- Keep uploaded objects quarantined until a malware scanner has accepted them. Scanner outage must not make an upload available.
- Back up database and object storage, and test the retention and deletion procedures before accepting customer data.
- Review the threat model and run the database isolation suite before launch.
