terraform {
  backend "s3" {
    key            = "prod/redstone/warp-contracts/gateway.tfstate"
    bucket         = "redstone-terraform-state-prod"
    dynamodb_table = "redstone-terraform-state-lock"
    region         = "us-east-1"
  }
}
