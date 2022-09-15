locals {
  default-tags = {
    env         = var.env
    service     = "warp-gateway"
    provisioner = "terraform"
  }
}
provider "aws" {
  region = var.region
  default_tags {
    tags = local.default-tags
  }
}
provider "aws" {
  alias = "virginia"
  region = "us-east-1"
  default_tags {
    tags = local.default-tags
  }
}
module "warp-gateway" {
  source          = "../../modules/ecs-warp-gateway"
  env             = var.env
  alb-name        = data.aws_ssm_parameter.alb-name.value
  cluster-arn     = data.aws_ssm_parameter.cluster-arn.value
  vpc-id          = data.aws_ssm_parameter.vpc-id.value
  subnet-ids      = data.aws_subnets.private.ids
  image-repo      = data.aws_ssm_parameter.warp-gateway-uri.value
  db-host         = data.aws_ssm_parameter.warp-gateway-db-host.arn
  db-name         = data.aws_ssm_parameter.warp-gateway-db-name.arn
  db-pass         = data.aws_ssm_parameter.warp-gateway-db-password.arn
  db-port         = data.aws_ssm_parameter.warp-gateway-db-port.arn
  db-user         = data.aws_ssm_parameter.warp-gateway-db-user.arn
  vrf-private-key = data.aws_ssm_parameter.warp-gateway-vrf-public.arn
  vrf-pub-key     = data.aws_ssm_parameter.warp-gateway-vrf-private.arn
  warp-wallet-jwk = data.aws_ssm_parameter.warp-gateway-arweave-jwk-key.arn
}
data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_ssm_parameter.vpc-id.value]
  }
  tags = {
    Tier = "Private"
  }
}
data "aws_ssm_parameter" "cluster-arn" {
  name = "/${var.env}/redstone/infrastructure/ecs-cluster-arn"
}
data "aws_ssm_parameter" "vpc-id" {
  name = "/${var.env}/redstone/infrastructure/vpc-id"
}
data "aws_ssm_parameter" "alb-name" {
  name = "/${var.env}/redstone/infrastructure/alb-name"
}
data "aws_ssm_parameter" "warp-gateway-uri" {
  name = "/${var.env}/redstone/infrastructure/ecr/warp-gateway-uri"
  provider = aws.virginia
}
data "aws_ssm_parameter" "warp-gateway-db-host" {
  name = "/${var.env}/warp-contract/gateway/db/host"
  provider = aws.virginia
}

data "aws_ssm_parameter" "warp-gateway-db-name" {
  name = "/${var.env}/warp-contract/gateway/db/name"
  provider = aws.virginia
}

data "aws_ssm_parameter" "warp-gateway-db-user" {
  name = "/${var.env}/warp-contract/gateway/db/user"
  provider = aws.virginia
}

data "aws_ssm_parameter" "warp-gateway-db-password" {
  name = "/${var.env}/warp-contract/gateway/db/password"
  provider = aws.virginia
}

data "aws_ssm_parameter" "warp-gateway-db-port" {
  name = "/${var.env}/warp-contract/gateway/db/port"
  provider = aws.virginia
}

data "aws_ssm_parameter" "warp-gateway-vrf-public" {
  name = "/${var.env}/warp-contract/gateway/vrf/public"
  provider = aws.virginia
}

data "aws_ssm_parameter" "warp-gateway-vrf-private" {
  name = "/${var.env}/warp-contract/gateway/vrf/private"
  provider = aws.virginia
}

data "aws_ssm_parameter" "warp-gateway-arweave-jwk-key" {
  name = "/${var.env}/warp-contract/gateway/arweave-jwk-key"
  provider = aws.virginia
}
