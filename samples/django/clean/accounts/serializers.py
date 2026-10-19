from rest_framework import serializers

from orgs.models import Membership

from .models import User


class MembershipSummarySerializer(serializers.ModelSerializer):
    org_name = serializers.CharField(source="org.name", read_only=True)

    class Meta:
        model = Membership
        fields = ["org", "org_name", "role"]


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)


class MeSerializer(serializers.ModelSerializer):
    memberships = MembershipSummarySerializer(many=True, read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "api_token", "memberships"]
        read_only_fields = fields


class TeammateSerializer(serializers.ModelSerializer):
    memberships = MembershipSummarySerializer(many=True, read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "memberships"]
