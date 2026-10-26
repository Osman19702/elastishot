// A server command that fails before it serves anything, like a missing dependency.
console.error('Error: Cannot find module "vite"')
process.exit(1)
