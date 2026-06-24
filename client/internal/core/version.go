package core

// BuildCommit is the git commit the binary was built from, injected via -ldflags at
// build time (see install.sh). "dev" when built without ldflags. Both the self-update
// freshness comparison and the version/status output read this single source.
var BuildCommit = "dev"
