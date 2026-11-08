# Docker Hub publishing for Patzer forks

The fork preserves the upstream `.github/workflows/docker-publish.yml` but
**does not publish automatically** until its owner deliberately enables it.
The upstream image `docker.io/sikamikaniko123/patzer` belongs to the original
maintainer; this fork must not attempt to publish updates there.

## Enabling your own Docker Hub release

1. Create a Docker Hub repository under **your own Docker Hub namespace**,
   such as `docker.io/YOUR_DOCKERHUB_USERNAME/patzer`.
2. In **GitHub → repository Settings → Secrets and variables → Actions → Secrets**
   create `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` for an account that has
   permission to publish that image. Use a scoped Docker Hub access token.
3. Under **Actions → Variables**, create:
   - `PATZER_DOCKER_IMAGE`: `docker.io/YOUR_DOCKERHUB_USERNAME/patzer`
   - `PATZER_DOCKER_PUBLISH`: `true`
4. Push to `main` or manually run **Publish to Docker Hub**. The job publishes
   the configured `latest`, commit-short-SHA, and branch tags.

Leave the variable unset or set to `false` if you are **not** using Docker Hub.
In that state the publishing job is **skipped**, not failed. The existing
`CI` workflow still independently builds and boot-tests the Docker image on
pull requests and `main`; the GitHub Container Registry release workflow is
independent and continues to use `ghcr.io/${{ github.repository }}` on tags.

Never copy the upstream publisher's credentials or image namespace into a fork,
and do not print credentials in Actions logs or commit them to Git.
