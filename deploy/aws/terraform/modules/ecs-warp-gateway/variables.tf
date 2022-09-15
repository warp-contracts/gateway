variable "alb-name" {
  type = string
}
variable "env" {
  type = string
}
variable "max-capacity" {
  default = 15
}
variable "min-capacity" {
  default = 3
}
variable "service-name" {
  default = "warp-gateway"
}
variable "vpc-id" {}
variable "subnet-ids" {
  type = list(string)
}
variable "image-repo" {
  default = "public.ecr.aws/g4b4d3a5/warp-gateway"
}
variable "image-tag" {
  default = "latest"
}
variable "cluster-arn" {}

variable "container-port" {
  type = number
  default = 9000
}
variable "db-host" {
}
variable "db-user" {
}
variable "db-pass" {
}
variable "db-port" {
}
variable "db-name" {
}
variable "vrf-private-key" {
}
variable "vrf-pub-key" {
}
variable "warp-wallet-jwk" {
}
