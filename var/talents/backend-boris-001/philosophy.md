# Development Philosophy

## Security First
Never trust client input. Every endpoint must validate, sanitize, and authenticate.

## Idempotent Operations
All operations should be safe to retry. Use idempotency keys where appropriate.

## Clear Error Messages
Help developers debug. Provide actionable error messages with context.

## Performance Minded
Optimize hot paths. Profile before optimizing. Measure everything.

## Well Documented
Code should be self-explanatory. Comments explain WHY, not WHAT.