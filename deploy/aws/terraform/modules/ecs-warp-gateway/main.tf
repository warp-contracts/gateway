resource "aws_ecs_service" "this" {
  name        = var.service-name
  cluster     = var.cluster-arn
  launch_type = "EC2"

  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = 1
#  health_check_grace_period_seconds = 6

  network_configuration {
    subnets = var.subnet-ids
    security_groups = [
      aws_security_group.this.id
    ]
  }
}

resource "aws_ecs_task_definition" "this" {
  family                = var.service-name
  execution_role_arn = aws_iam_role.task-execution-role.arn
  network_mode = "awsvpc"
  container_definitions = jsonencode([
    {
      name : var.service-name
      image : "${var.image-repo}:${var.image-tag}"
      essential               = true
      memory                  = 1024
      RequiresCompatibilities = ["EC2"]
      portMappings : [
        {
          hostPort : var.container-port
          containerPort : var.container-port,
          protocol : "tcp"
        }
      ]
      containerDefinitions : [
        {
          image: "${var.image-repo}:${var.image-tag}"
        }
      ]
      secrets : [
        {
          name: "DB_HOST",
          valueFrom: var.db-host,
        },
        {
          name: "DB_USER",
          valueFrom: var.db-user,
        },
        {
          name: "DB_PASS",
          valueFrom: var.db-pass,
        },
        {
          name: "DB_PORT",
          valueFrom: var.db-port,
        },
        {
          name: "DB_NAME",
          valueFrom: var.db-name,
        },
        {
          name: "VRF_PUB_KEY",
          valueFrom: var.vrf-pub-key,
        },
        {
          name: "VRF_PRIV_KEY",
          valueFrom: var.vrf-private-key,
        },
        {
          name: "WARP_WALLET_JWK",
          valueFrom: var.warp-wallet-jwk,
        },
      ]
      logConfiguration : {
        logDriver : "awslogs",
        options : {
          "awslogs-group" : aws_cloudwatch_log_group.task-logs.name,
          "awslogs-region" : data.aws_region.current.name,
          "awslogs-stream-prefix" : "ecs"
        }
      },
    }
  ])
}

resource "aws_cloudwatch_log_group" "task-logs" {
  name = "/ecs/redstone/ecs/${var.service-name}"
}
resource "aws_iam_role_policy_attachment" "ecs-task-execution-role-default-policy-attachment" {
  role       = aws_iam_role.task-execution-role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_lb" "alb" {
  name = var.alb-name
}

resource "aws_lb_target_group" "this" {
  name_prefix = substr(replace(var.service-name, "-", ""), 0, 5)
  port        = var.container-port
  vpc_id      = var.vpc-id
  target_type = "ip"
  protocol    = "HTTP"
  health_check {
    enabled = true
    healthy_threshold = 2
    path = "/configs/tokens"
  }
}

resource "aws_lb_listener" "nlb_listener" {
  load_balancer_arn = data.aws_lb.alb.id
  port              = 443
  protocol          = "HTTP"
  default_action {
    target_group_arn = aws_lb_target_group.this.id
    type             = "forward"
  }
}

data "aws_region" "current" {}

resource "aws_iam_role" "task-execution-role" {
  name               = "${var.service-name}-task-execution-role"
  assume_role_policy = <<POLICY
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "ecs-tasks.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
POLICY
  inline_policy {
    name = "allowSecretsAccess"
    policy = <<POLICY
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": "ssm:GetParameters",
            "Resource": [
                "*"
            ]
        }
    ]
}
POLICY
  }
}

locals {
  sg-name = "ecs-service-${var.service-name}-${var.env}"
}
resource "aws_security_group" "this" {
  name = local.sg-name
  vpc_id = var.vpc-id
  ingress {
    protocol  = "TCP"
    from_port = var.container-port
    to_port   = var.container-port
    security_groups = data.aws_lb.alb.security_groups
  }
  egress {
    from_port = 0
    protocol  = -1
    to_port   = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = {
    Name: local.sg-name
  }
}
